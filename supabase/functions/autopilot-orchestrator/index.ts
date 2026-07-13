// Autopilot orchestrator — drives the full A-Z pipeline:
// topic QC → outline+QC → write (with per-chapter QC) → editorial QC →
// product copy + QC → cover → Shopify draft upload → final QC → publish (Full mode only).
//
// Idempotent: can be called multiple times for the same ebook_id. Uses
// `ebooks.autopilot_state` as the resume cursor.
import { corsHeaders, admin, requireAdmin, aiJSON, aiText, pickModel, logCost } from "../_shared/ai.ts";
import { HARDSELL_COPYWRITER_SYSTEM, PREMIUM_WRITER_SYSTEM } from "../_shared/prompts/adult.ts";
import { resolveTrack } from "../_shared/track-registry.ts";
import {
  TH, logRun,
  scoreTopic, topicGate, rewriteTopic,
  scoreOutline, outlineGate,
  scoreChapter, chapterGate, rewriteChapter,
  scoreEditorial,
  scoreProductCopy, productCopyGate,
  publishGate,
} from "../_shared/qc.ts";

interface Outline {
  toc: { title: string; brief: string }[];
  bonuses: { checklist: string; worksheet: string; templates: string; action_plan_7day: string };
}

interface ProductCopy {
  product_description: string;
  seo_title: string;
  seo_meta: string;
  tags: string[];
  cover_prompt: string;
}

async function callFn(name: string, body: unknown, authToken: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function wordCount(chapters: { content: string }[]) {
  return chapters.reduce((s, c) => s + ((c.content ?? "").trim() ? c.content.trim().split(/\s+/).length : 0), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id, ebook_id, mode = "safe" } = await req.json();
    if (!idea_id && !ebook_id) throw new Error("idea_id or ebook_id required");
    if (!["safe", "full", "manual"].includes(mode)) throw new Error("invalid mode");

    const auth = req.headers.get("Authorization")!.replace("Bearer ", "");

    // Resolve idea + settings
    let idea: any = null;
    let ebook: any = null;
    if (ebook_id) {
      const { data } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
      if (!data) throw new Error("Ebook not found");
      ebook = data;
      if (data.idea_id) {
        const { data: i } = await db.from("ebook_ideas").select("*").eq("id", data.idea_id).single();
        idea = i;
      }
    } else {
      const { data } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
      if (!data) throw new Error("Idea not found");
      idea = data;
    }

    // ---------- TRACK ROUTER ----------
    // Look up category slug so resolveTrack has full input regardless of
    // whether we started from an idea or an existing ebook.
    const categoryRow = (idea?.category_id || ebook?.category_id)
      ? (await db.from("categories").select("slug, default_price")
          .eq("id", idea?.category_id ?? ebook?.category_id).maybeSingle()).data
      : null;
    const track = resolveTrack((ebook ?? idea) as any, categoryRow?.slug ?? null);
    if (track === "kids") {
      console.log("autopilot-orchestrator: routing to kids track", { ebook_id: ebook?.id, idea_id: idea?.id });
      if (!ebook?.id) {
        return new Response(JSON.stringify({
          error: "kids track requires an existing ebook_id (create the kids ebook first, then trigger autopilot)",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/autopilot-kids`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
        body: JSON.stringify({ ebook_id: ebook.id, mode }),
      });
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).maybeSingle();
    const genMode = settings?.mode ?? "hybrid";
    const minWords: number = Number(settings?.min_word_count ?? 18000);
    const qcModel = pickModel(genMode, "qc");
    const writeModel = pickModel(genMode, "content");
    const mktModel = pickModel(genMode, "marketing");

    const category = idea?.category_id
      ? (await db.from("categories").select("*").eq("id", idea.category_id).maybeSingle()).data
      : null;
    const price = Number(category?.default_price ?? 24.99);

    // Background pipeline
    const pipeline = (async () => {
      let totalCost = 0;
      const stamp = async (state: string, patch: Record<string, unknown> = {}) => {
        if (ebook?.id) await db.from("ebooks").update({ autopilot_state: state, autopilot_mode: mode, ...patch }).eq("id", ebook.id);
        if (idea?.id && !ebook?.id) await db.from("ebook_ideas").update({ status: state }).eq("id", idea.id);
      };

      try {
        // ---------- STEP 1: TOPIC QC + auto-rewrite ----------
        if (idea && (idea.topic_rewrite_count ?? 0) === 0 && idea.premium_score == null) {
          await stamp("qc_topic");
          let rewrites = idea.topic_rewrite_count ?? 0;
          let currentIdea = { ...idea };
          let topicScores = await scoreTopic(qcModel, { ...currentIdea, category: category?.name });
          totalCost += topicScores.usage.cost_usd;
          await logCost(db, { idea_id: idea.id, step: "qc_topic", model: topicScores.model, ...topicScores.usage });
          await logRun(db, { idea_id: idea.id, step: "qc_topic", status: "ok", score: topicScores.data.buyer_appeal_score, cost_usd: topicScores.usage.cost_usd, payload: topicScores.data as any });

          let gate = topicGate(topicScores.data);
          while (!gate.pass && rewrites < TH.maxTopicRewrites) {
            rewrites++;
            const complianceMode = topicScores.data.compliance_risk_score > TH.topicMaxCompliance;
            const rw = await rewriteTopic(qcModel, { ...currentIdea, category: category?.name }, gate.reason, complianceMode);
            totalCost += rw.usage.cost_usd;
            await logCost(db, { idea_id: idea.id, step: `qc_topic_rewrite_${rewrites}`, model: rw.model, ...rw.usage });
            currentIdea = { ...currentIdea, ...rw.data };
            topicScores = await scoreTopic(qcModel, { ...currentIdea, category: category?.name });
            totalCost += topicScores.usage.cost_usd;
            await logCost(db, { idea_id: idea.id, step: `qc_topic_rescore_${rewrites}`, model: topicScores.model, ...topicScores.usage });
            await logRun(db, { idea_id: idea.id, step: "qc_topic", status: "rewrite", score: topicScores.data.buyer_appeal_score, rewrite_count: rewrites, cost_usd: rw.usage.cost_usd + topicScores.usage.cost_usd, payload: topicScores.data as any });
            gate = topicGate(topicScores.data);
          }

          await db.from("ebook_ideas").update({
            title: currentIdea.title,
            subtitle: currentIdea.subtitle,
            hook: currentIdea.hook,
            premium_score: topicScores.data.premium_score,
            hard_sell_score: topicScores.data.hard_sell_strength_score,
            commercial_intent_score: topicScores.data.commercial_intent_score,
            clarity_score: topicScores.data.clarity_score,
            compliance_risk_score: topicScores.data.compliance_risk_score,
            topic_rewrite_count: rewrites,
            cost_usd: Number(idea.cost_usd ?? 0) + totalCost,
            scores: { ...(idea.scores ?? {}), ...topicScores.data, buyer_appeal_score: topicScores.data.buyer_appeal_score },
          }).eq("id", idea.id);
          idea = { ...idea, ...currentIdea };

          if (!gate.pass) {
            await db.from("ebook_ideas").update({ status: "rejected", auto_rejected_reason: `topic QC fail: ${gate.reason}` }).eq("id", idea.id);
            await logRun(db, { idea_id: idea.id, step: "qc_topic", status: "reject", error: gate.reason, rewrite_count: rewrites });
            return;
          }
        }

        // ---------- STEP 2: Create ebook row if needed ----------
        if (!ebook) {
          const { data: e, error } = await db.from("ebooks").insert({
            idea_id: idea.id, category_id: idea.category_id,
            title: idea.title, subtitle: idea.subtitle, target_buyer: idea.target_buyer, hook: idea.hook,
            status: "outline", price, autopilot_mode: mode, autopilot_state: "qc_outline",
          }).select("*").single();
          if (error || !e) throw new Error(`create ebook: ${error?.message}`);
          ebook = e;
          await db.from("ebook_ideas").update({ status: "outline" }).eq("id", idea.id);
        }

        // ---------- STEP 3: OUTLINE + QC ----------
        if (!ebook.toc || (Array.isArray(ebook.toc) && ebook.toc.length === 0)) {
          await stamp("qc_outline");
          let outline: { toc: { title: string; brief: string }[]; bonuses: Record<string, string> } | null = null;
          let outlineScores: any = null;
          let rewrites = 0;

          for (; rewrites <= TH.maxOutlineRewrites; rewrites++) {
            const ai = await aiJSON<Outline>({
              model: writeModel,
              system: PREMIUM_WRITER_SYSTEM + (rewrites > 0 ? `\n\nPREVIOUS OUTLINE WAS REJECTED. Fix these issues: ${outlineScores?.data?.notes ?? "weak structure"}.` : ""),
              user: `Title: ${ebook.title}\nSubtitle: ${ebook.subtitle ?? ""}\nReader: ${ebook.target_buyer ?? ""}\nHook: ${ebook.hook ?? ""}\n\nDesign a TOC with EXACTLY 10 chapters. Each chapter title must be specific and the brief must name the transformation in 2-3 sentences. Then design these bonus sections: checklist, worksheet, templates, 7-day action plan.\n\nReturn JSON: { "toc": [{"title":"...","brief":"..."},...10], "bonuses": { "checklist": "...", "worksheet": "...", "templates": "...", "action_plan_7day": "..." } }`,
            });
            totalCost += ai.usage.cost_usd;
            await logCost(db, { ebook_id: ebook.id, step: rewrites === 0 ? "outline" : `outline_rewrite_${rewrites}`, model: ai.model, ...ai.usage });
            outline = ai.data;
            outlineScores = await scoreOutline(qcModel, { title: ebook.title, ...ai.data });
            totalCost += outlineScores.usage.cost_usd;
            await logCost(db, { ebook_id: ebook.id, step: `outline_qc_${rewrites}`, model: outlineScores.model, ...outlineScores.usage });
            const g = outlineGate(outlineScores.data);
            await logRun(db, { ebook_id: ebook.id, step: "qc_outline", status: g.pass ? "ok" : "rewrite", score: outlineScores.data.structure_score, rewrite_count: rewrites, cost_usd: ai.usage.cost_usd + outlineScores.usage.cost_usd, payload: outlineScores.data });
            if (g.pass) break;
            if (rewrites === TH.maxOutlineRewrites) {
              await db.from("ebooks").update({ autopilot_state: "rejected", needs_review_reason: `outline QC fail: ${g.reason}`, status: "qc_failed" }).eq("id", ebook.id);
              await logRun(db, { ebook_id: ebook.id, step: "qc_outline", status: "reject", error: g.reason });
              return;
            }
          }

          await db.from("ebooks").update({
            toc: outline!.toc, bonuses: outline!.bonuses, status: "writing", cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
          }).eq("id", ebook.id);
          await db.from("ebook_ideas").update({
            outline_structure_score: outlineScores.data.structure_score,
            outline_practical_score: outlineScores.data.practical_score,
            outline_buyer_score: outlineScores.data.buyer_score,
            outline_depth_score: outlineScores.data.depth_score,
            outline_premium_score: outlineScores.data.premium_score,
            outline_duplicate_score: outlineScores.data.duplicate_score,
            outline_rewrite_count: rewrites,
          }).eq("id", idea.id);
          ebook = { ...ebook, toc: outline!.toc, bonuses: outline!.bonuses };
        }

        // ---------- STEP 4: WRITE CHAPTERS + per-chapter QC ----------
        const toc: { title: string; brief: string }[] = ebook.toc;
        const wordsPerChapter = Math.max(1800, Math.ceil((minWords * 1.2) / Math.max(toc.length, 1)));
        let chapters: { title: string; content: string }[] = Array.isArray(ebook.chapters) ? ebook.chapters : [];
        const chapterQc: Record<string, any> = ebook.chapter_qc ?? {};

        for (let i = chapters.length; i < toc.length; i++) {
          const ch = toc[i];
          await db.from("ebooks").update({ autopilot_state: `writing:${i + 1}/${toc.length}`, status: `writing:${i + 1}/${toc.length}` }).eq("id", ebook.id);

          let content = "";
          {
            const wAI = await aiText({
              model: writeModel,
              system: PREMIUM_WRITER_SYSTEM,
              user: `Ebook: "${ebook.title}" — ${ebook.subtitle ?? ""}\nReader: ${ebook.target_buyer ?? ""}\nHook: ${ebook.hook ?? ""}\n\nWrite Chapter "${ch.title}". Brief: ${ch.brief}\n\nHARD REQUIREMENT: minimum ${wordsPerChapter} words. Do not stop early. Expand each section with concrete examples, scripts, numbers, and step-by-step detail until you exceed the minimum.\n\nFollow the chapter structure (objective → main teaching → practical example → common mistake → step-by-step → quick checklist → key takeaway). American English. Do NOT include the chapter number or the word "Chapter" in the body.`,
            });
            content = wAI.data;
            totalCost += wAI.usage.cost_usd;
            await logCost(db, { ebook_id: ebook.id, step: `chapter:${ch.title}`.slice(0, 80), model: wAI.model, ...wAI.usage });
          }

          // QC + one rewrite if needed
          let qc = await scoreChapter(qcModel, ch.title, content);
          totalCost += qc.usage.cost_usd;
          await logCost(db, { ebook_id: ebook.id, step: `chapter_qc:${i + 1}`, model: qc.model, ...qc.usage });
          let g = chapterGate(qc.data);
          let rewrites = 0;
          if (!g.pass && rewrites < TH.maxChapterRewrites) {
            rewrites++;
            const rw = await rewriteChapter(writeModel, {
              ebookTitle: ebook.title, subtitle: ebook.subtitle, targetBuyer: ebook.target_buyer, hook: ebook.hook,
              chapterTitle: ch.title, brief: ch.brief, currentContent: content, issues: qc.data.issues, minWords: wordsPerChapter,
            });
            content = rw.data;
            totalCost += rw.usage.cost_usd;
            await logCost(db, { ebook_id: ebook.id, step: `chapter_rewrite:${i + 1}`, model: rw.model, ...rw.usage });
            qc = await scoreChapter(qcModel, ch.title, content);
            totalCost += qc.usage.cost_usd;
            await logCost(db, { ebook_id: ebook.id, step: `chapter_rescore:${i + 1}`, model: qc.model, ...qc.usage });
            g = chapterGate(qc.data);
          }
          chapterQc[String(i + 1)] = { scores: qc.data, rewrites, pass: g.pass, reason: g.reason };
          await logRun(db, { ebook_id: ebook.id, step: `qc_chapter_${i + 1}`, status: g.pass ? "ok" : "fail", score: qc.data.buyer_value_score, rewrite_count: rewrites, payload: qc.data as any });

          chapters.push({ title: ch.title, content });
          await db.from("ebooks").update({
            chapters, chapter_qc: chapterQc, word_count: wordCount(chapters), cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
          }).eq("id", ebook.id);
        }

        // ---------- STEP 5: EDITORIAL QC ----------
        await stamp("qc_editorial");
        const ed = await scoreEditorial(qcModel, { title: ebook.title, toc, chapters, bonuses: ebook.bonuses ?? {} });
        totalCost += ed.usage.cost_usd;
        await logCost(db, { ebook_id: ebook.id, step: "qc_editorial", model: ed.model, ...ed.usage });
        await logRun(db, { ebook_id: ebook.id, step: "qc_editorial", status: ed.data.final_quality_score >= 80 ? "ok" : "fail", score: ed.data.final_quality_score, payload: ed.data as any });

        await db.from("ebooks").update({
          editorial_qc: ed.data,
          final_quality_score: ed.data.final_quality_score,
          compliance_safety_score: ed.data.compliance_safety_score,
        }).eq("id", ebook.id);

        // ---------- STEP 6: PRODUCT COPY + QC ----------
        await stamp("product_copy");
        let copy: ProductCopy | null = null;
        let copyScores: any = null;
        for (let r = 0; r <= TH.maxProductCopyRewrites; r++) {
          const ai = await aiJSON<ProductCopy>({
            model: mktModel,
            system: HARDSELL_COPYWRITER_SYSTEM + (r > 0 ? `\n\nPREVIOUS COPY FAILED QC: ${copyScores?.data?.issues?.join("; ") ?? "weak"}. Rewrite stronger and safer.` : ""),
            user: `Ebook: "${ebook.title}" — ${ebook.subtitle ?? ""}\nReader: ${ebook.target_buyer ?? ""}\nHook: ${ebook.hook ?? ""}\nTOC: ${toc.map((t) => t.title).join("; ")}\nBonuses: ${Object.values(ebook.bonuses ?? {}).join(" | ")}\n\nWrite Shopify product page copy:\n1) Hard-sell hook (1-2 sentences naming the buyer's pain)\n2) Cost of doing nothing (1-2 sentences)\n3) Transformation (1-2 sentences, believable, not guaranteed)\n4) Clear benefits (4-6 bullets)\n5) What's inside (chapter list + bonuses)\n6) Who it's for (3 bullets)\n7) Objection handling (3 Q&A)\n8) Bonus value\n9) Honest CTA (no fake urgency)\n\nReturn JSON: { "product_description": "<markdown>", "seo_title": "<=60 chars", "seo_meta": "<=160 chars", "tags": ["..."], "cover_prompt": "single-paragraph image-gen prompt for a premium clean cover" }`,
          });
          totalCost += ai.usage.cost_usd;
          await logCost(db, { ebook_id: ebook.id, step: r === 0 ? "product_copy" : `product_copy_rewrite_${r}`, model: ai.model, ...ai.usage });
          copy = ai.data;
          copyScores = await scoreProductCopy(qcModel, ai.data);
          totalCost += copyScores.usage.cost_usd;
          await logCost(db, { ebook_id: ebook.id, step: `product_copy_qc_${r}`, model: copyScores.model, ...copyScores.usage });
          const g = productCopyGate(copyScores.data);
          await logRun(db, { ebook_id: ebook.id, step: "qc_product_copy", status: g.pass ? "ok" : "rewrite", score: copyScores.data.conversion_score, rewrite_count: r, payload: copyScores.data as any });
          if (g.pass || r === TH.maxProductCopyRewrites) break;
        }

        await db.from("ebooks").update({
          product_description: copy!.product_description,
          seo_title: copy!.seo_title, seo_meta: copy!.seo_meta,
          tags: copy!.tags, cover_prompt: copy!.cover_prompt,
          product_copy: copy as any,
          product_page_qc: copyScores.data,
          conversion_score: copyScores.data.conversion_score,
        }).eq("id", ebook.id);

        // ---------- STEP 7: COVER ----------
        if (!ebook.cover_url) {
          await stamp("cover");
          try {
            await callFn("generate-cover", { ebook_id: ebook.id }, auth);
            await logRun(db, { ebook_id: ebook.id, step: "cover", status: "ok" });
          } catch (e) {
            await logRun(db, { ebook_id: ebook.id, step: "cover", status: "fail", error: String(e) });
          }
        }

        // ---------- STEP 8: BUILD PDF ----------
        await stamp("build_pdf");
        try {
          await callFn("build-pdf", { ebook_id: ebook.id }, auth);
          await logRun(db, { ebook_id: ebook.id, step: "build_pdf", status: "ok" });
        } catch (e) {
          await logRun(db, { ebook_id: ebook.id, step: "build_pdf", status: "fail", error: String(e) });
        }

        // ---------- STEP 9: SHOPIFY DRAFT ----------
        await stamp("shopify_draft");
        try {
          await callFn("push-to-shopify", { ebook_id: ebook.id }, auth);
          await db.from("ebooks").update({ shopify_status: "draft" }).eq("id", ebook.id);
          await logRun(db, { ebook_id: ebook.id, step: "shopify_draft", status: "ok" });
        } catch (e) {
          await db.from("ebooks").update({ shopify_status: "failed", needs_review_reason: `shopify upload failed: ${String(e).slice(0, 200)}` }).eq("id", ebook.id);
          await logRun(db, { ebook_id: ebook.id, step: "shopify_draft", status: "fail", error: String(e) });
          await stamp("needs_review");
          return;
        }

        // ---------- STEP 10: FINAL PUBLISH GATE ----------
        const { data: fresh } = await db.from("ebooks").select("*").eq("id", ebook.id).single();
        const g = publishGate(fresh!);
        await logRun(db, { ebook_id: ebook.id, step: "qc_final_product", status: g.pass ? "ok" : "fail", payload: { reasons: g.reasons } });

        if (mode === "full" && g.pass) {
          try {
            await callFn("shopify-publish", { ebook_id: ebook.id }, auth);
            await db.from("ebooks").update({ shopify_status: "published", status: "published", autopilot_state: "done" }).eq("id", ebook.id);
            await logRun(db, { ebook_id: ebook.id, step: "publish", status: "ok" });
          } catch (e) {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: `publish failed: ${String(e).slice(0, 200)}` }).eq("id", ebook.id);
            await logRun(db, { ebook_id: ebook.id, step: "publish", status: "fail", error: String(e) });
          }
        } else {
          await db.from("ebooks").update({
            autopilot_state: g.pass ? "ready_to_publish" : "needs_review",
            needs_review_reason: g.pass ? null : g.reasons.join("; "),
            status: g.pass ? "uploaded" : "needs_review",
          }).eq("id", ebook.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("autopilot pipeline failed:", err);
        if (ebook?.id) {
          await db.from("ebooks").update({ autopilot_state: "failed", needs_review_reason: msg.slice(0, 400) }).eq("id", ebook.id);
        }
        await logRun(db, { ebook_id: ebook?.id, idea_id: idea?.id, step: "pipeline", status: "fail", error: msg });
      }
    })();

    // @ts-ignore - EdgeRuntime is available in Supabase runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(pipeline);

    return new Response(JSON.stringify({ ok: true, mode, ebook_id: ebook?.id, idea_id: idea?.id, async: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
