// Kids full-repair orchestrator — story rewrite + bible re-lock + interior
// reroll + PDF re-render + measured QC + strict publish gate.
//
// This is invoked for books that failed measured QC broadly (systemic story
// weakness, style drift, cover/interior mismatch). It phases work so it can
// be re-called safely if any step times out — every step writes state to DB
// and skips work that already meets the target unless `force` says otherwise.
//
// POST body:
//   {
//     ebook_id: string,
//     phase?: "all" | "story" | "bibles" | "interior" | "pdf" | "qc",
//     force?: { story?: boolean, bibles?: boolean, interior?: boolean, pdf?: boolean },
//     publish?: boolean,
//     target_illustrations?: number  // default 12
//   }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildScenePlan, renderInteriorIllustrations } from "../_shared/kids-interior.ts";
import { buildPicturePdf } from "../_shared/kids-picture-pdf.ts";
import { runKidsStoryJudge } from "../_shared/kids-story-judge.ts";
import { isReferenceModelAvailable } from "../_shared/kids-image-gen.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function ai(model: string, system: string, user: string, imageUrls: string[] = []): Promise<string> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: user }];
  for (const u of imageUrls) content.push({ type: "image_url", image_url: { url: u } });
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `${system}\n\nCRITICAL: English only. Return ONLY JSON. No markdown fences.` },
        { role: "user", content: imageUrls.length ? content : user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ai ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
  const ebook_id = body.ebook_id as string;
  if (!ebook_id) return json({ ok: false, error: "ebook_id required" }, 400);
  const phase = (body.phase as string) ?? "all";
  const force = (body.force ?? {}) as Record<string, boolean>;
  const publish = body.publish !== false;
  const targetIllos = Math.max(12, Math.min(16, (body.target_illustrations as number) ?? 12));
  const runInBackground = body.background !== false;
  const skipStoryGate = body.skip_story_gate === true;
  const storyMaxAttempts = Math.max(1, Math.min(3, (body.story_max_attempts as number) ?? 2));
  let storyGatePassed = false;

  const log: Array<Record<string, unknown>> = [];
  const startedAt = new Date().toISOString();

  async function persistLog(extra: Record<string, unknown> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cur } = await (db.from("ebooks_kids") as any)
      .select("qc_scorecard").eq("id", ebook_id).single();
    const sc = (cur?.qc_scorecard ?? {}) as Record<string, unknown>;
    sc.repair_log = { started_at: startedAt, updated_at: new Date().toISOString(), phase, log, ...extra };
    await db.from("ebooks_kids").update({ qc_scorecard: sc }).eq("id", ebook_id);
  }

  async function runRepair() {
    try {
      await runRepairInner();
    } catch (e) {
      log.push({ step: "fatal_error", error: String((e as Error)?.message ?? e).slice(0, 500) });
      await persistLog({ status: "error" });
    }
  }

  async function runRepairInner() {
    const { data: eb } = await db.from("ebooks_kids").select("*").eq("id", ebook_id).single();
    if (!eb) { log.push({ step: "not_found" }); await persistLog({ status: "error" }); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (db.from("kids_book_bibles") as any)
      .select("*").eq("ebook_id", ebook_id).maybeSingle();

    const runAll = phase === "all";


    // ============================================================
    // PHASE 1 — STORY REWRITE
    // ============================================================
    if (runAll || phase === "story") {
      const title = eb.title as string;
      const subtitle = (eb.subtitle as string | null) ?? null;

      // Skip initial judge when forced — save ~15s
      let currentPass = false;
      if (!force.story) {
        try {
          const judge = await runKidsStoryJudge({
            title, subtitle, ageBand: "4-6",
            manuscript_md: (eb.manuscript_md as string) ?? "",
          });
          currentPass = judge.story_qc_passed;
          log.push({ step: "story_judge_initial", pass: currentPass, scores: {
            age: judge.age_appropriateness_score, coh: judge.story_coherence_score,
            emo: judge.emotional_payoff_score, rer: judge.reread_value_score,
            lang: judge.language_level_score, buyer: judge.parent_buyer_value_score,
            generic_risk: judge.generic_story_risk_score,
          }});
        } catch (e) {
          log.push({ step: "story_judge_initial", error: String((e as Error).message) });
        }
      }

      if (force.story || !currentPass) {
        let bestScore = -1;
        let judgePassed = currentPass;
        let lastJudge: Record<string, number> | null = null;
        for (let attempt = 1; attempt <= storyMaxAttempts && !judgePassed; attempt++) {
          const escalated = attempt >= 2;
          const rewriteSystem = escalated
            ? `You are an award-winning children's picture book author for ages 4-6. You write books that PASS a strict editor's judge measuring: age_appropriateness>=90, language_level>=90, story_coherence>=90, reread_value>=85, emotional_payoff>=85, parent_buyer_value>=85, generic_story_risk<=25. On this attempt your previous draft FAILED because it was too generic, too abstract for a 4-year-old, and lacked a strong emotional payoff. Fix all of that now.`
            : `You are an award-winning children's picture book author writing for ages 4-6. You write books that parents buy, reread, and remember.`;

          const extra = escalated
            ? `

CRITICAL REPAIR NOTES (previous attempt failed):
- Language MUST be kindergarten-simple: 6-10 words per sentence, monosyllabic where natural, ZERO metaphors an adult would write ("pulsing in her bones", "shimmery lullaby", "woven into"). Prefer concrete verbs a 4-year-old knows ("hum", "hop", "tap", "peek", "snuggle").
- The refrain must be 2-3 SIMPLE words a child can chant, and appear on at least 4 spreads.
- Give the moon a SPECIFIC, tender secret with a concrete visible detail (e.g. moonbeams are quiet lullabies the moon collects in a silver pocket, or the moon rocks a nest of sleepy stars). Do not use "listens to sounds" or "watches over you".
- Every spread must move the plot. No filler descriptions.
- Emotional payoff on the last spread: Luna says or does one specific tender thing that shows she learned/felt something. Not just "she fell asleep smiling".
- Add 2 clear page-turn surprise beats where the child wants to turn the page.
- Avoid: "close your eyes", "sweet dreams", "goodnight moon", "little did she know", "and then", overly poetic adult diction.
`
            : "";

          const rewriteUser = `Rewrite the manuscript for the following picture book. Preserve the title, subtitle, and hero name "Luna". This is a cozy bedtime book with gentle wonder.

Title: "${title}"
Subtitle: "${subtitle ?? ""}"
Hero: Luna, a small child in cozy star pajamas
Theme: bedtime, gentle wonder, emotional calm, moon's secret
Tone: warm, whimsical, sleepy, emotionally reassuring

REQUIREMENTS (all mandatory):
- ${targetIllos} distinct illustrated spreads, one paragraph per spread
- 40-70 words per spread, 500-800 words total
- Distinctive premise (the moon's secret must be specific, surprising, tender)
- Luna has a clear emotional need at page 1
- Rising wonder in middle pages, quiet climax where Luna discovers the moon's secret
- Satisfying, specific, earned emotional payoff on the last spread
- A repeated cozy refrain phrase (2-3 SIMPLE words) that appears on at least 4 spreads
- Short read-aloud sentences, grade K-1 vocabulary, concrete sensory words
- Sound/touch/warmth detail; no adult metaphors; no preachy moral
- 2 page-turn surprise beats${extra}

Return JSON:
{
  "manuscript_md": "<full manuscript, paragraphs separated by blank lines, one paragraph per spread>",
  "refrain": "<the repeated cozy phrase>",
  "premise": "<one-sentence distinctive premise>",
  "spreads": [
    { "index": 1, "text": "<spread text>", "scene": "<one-sentence visual description>", "emotion": "<beat>", "setting": "<place>" }
  ]
}`;

          const modelChain = escalated
            ? ["google/gemini-2.5-pro", "google/gemini-2.5-flash"] as const
            : ["google/gemini-2.5-flash", "google/gemini-2.5-pro"] as const;

          let raw = "";
          let usedModel = "";
          for (const m of modelChain) {
            try {
              raw = await ai(m, rewriteSystem, rewriteUser);
              if (raw && raw.length > 200) { usedModel = m; break; }
            } catch (e) {
              log.push({ step: "story_rewrite_model_try", attempt, model: m, error: String((e as Error).message).slice(0, 160) });
            }
          }
          try {
            if (!raw) throw new Error("no rewrite output from any model");
            const parsed = JSON.parse(raw) as { manuscript_md: string; spreads?: Array<Record<string, unknown>>; refrain?: string; premise?: string };
            if (!parsed.manuscript_md || !Array.isArray(parsed.spreads) || parsed.spreads.length < targetIllos - 2) {
              log.push({ step: "story_rewrite_attempt", attempt, status: "malformed", model: usedModel, raw_len: raw.length });
              continue;
            }

            const j2 = await runKidsStoryJudge({
              title, subtitle, ageBand: "4-6",
              manuscript_md: parsed.manuscript_md,
              page_texts: parsed.spreads.map((s) => String(s.text ?? "")),
            });
            const composite = j2.age_appropriateness_score + j2.story_coherence_score
              + j2.emotional_payoff_score + j2.reread_value_score + j2.language_level_score
              + j2.parent_buyer_value_score - j2.generic_story_risk_score;
            lastJudge = {
              age: j2.age_appropriateness_score, coh: j2.story_coherence_score,
              emo: j2.emotional_payoff_score, rer: j2.reread_value_score,
              lang: j2.language_level_score, buyer: j2.parent_buyer_value_score,
              generic_risk: j2.generic_story_risk_score,
            };
            log.push({ step: "story_rewrite_attempt", attempt, model: usedModel, pass: j2.story_qc_passed, composite, scores: lastJudge, refrain: parsed.refrain, premise: parsed.premise });

            if (composite > bestScore || j2.story_qc_passed) {
              bestScore = composite;
              await db.from("ebooks_kids").update({
                manuscript_md: parsed.manuscript_md,
                word_count: parsed.manuscript_md.split(/\s+/).filter(Boolean).length,
                story_bible: {
                  version: 3, refrain: parsed.refrain, premise: parsed.premise,
                  target_illustrations: targetIllos,
                  spreads: parsed.spreads,
                },
              }).eq("id", ebook_id);
            }
            if (j2.story_qc_passed) { judgePassed = true; break; }
          } catch (e) {
            log.push({ step: "story_rewrite_attempt", attempt, error: String((e as Error).message).slice(0, 200) });
          }
        }
        storyGatePassed = judgePassed;
        log.push({ step: "story_rewrite_done", best_composite: bestScore, story_gate_passed: judgePassed, last_scores: lastJudge });
        await persistLog({ story_gate_passed: judgePassed });
      } else {
        storyGatePassed = true;
        log.push({ step: "story_rewrite_skipped", reason: "initial_judge_passed" });
        await persistLog({ story_gate_passed: true });
      }

      // Hard gate: do not touch art if the story judge did not pass.
      if (!storyGatePassed && !skipStoryGate && runAll) {
        log.push({ step: "aborted_before_art", reason: "story_judge_failed", note: "no image cost spent; fix story then re-invoke" });
        await db.from("ebooks_kids").update({
          listing_status: "draft", status: "needs_revision", pipeline_status: "human_review_required",
        }).eq("id", ebook_id);
        await persistLog({ status: "story_gate_blocked" });
        return;
      }
    }


    // Refresh ebook after phase 1
    const { data: eb2 } = await db.from("ebooks_kids").select("*").eq("id", ebook_id).single();

    // ============================================================
    // PHASE 2 — CHARACTER + STYLE BIBLE RE-LOCK (cover-anchored)
    // ============================================================
    if (runAll || phase === "bibles") {
      if (!eb2!.cover_url) throw new Error("cover_url required to lock bibles");
      const system = `You are an art director locking a picture-book character + style bible. You look at the cover image and extract the EXACT visible features of the hero character and the illustration style. Return only what is visible; do not invent. Integer palette hexes.`;
      const user = `Book title: "${eb2!.title}". Hero name: Luna. Look at the attached cover image.

Return JSON exactly:
{
  "character_bible": {
    "name": "Luna",
    "species": "human child",
    "skin_tone_hex": "#",
    "skin_tone_words": "<e.g. warm tan / fair peach>",
    "hair_color": "",
    "hair_style": "<e.g. two soft pigtails with waves / single loose bun>",
    "eye_shape": "",
    "eye_color": "",
    "outfit": "<full description of pajamas including sleeves, collar, length>",
    "outfit_pattern": "<e.g. embroidered gold star motif on chest / all-over printed stars>",
    "outfit_colors_hex": ["#","#"],
    "signature_prop": "<if any>",
    "body_proportions": "<age appearance, head/body ratio>",
    "invariant_features": "<one-sentence lock line>",
    "forbidden_variations": ["do not change skin tone", "do not change star embroidery to printed stars", "do not change hair style"]
  },
  "style_bible": {
    "line_quality": "",
    "palette": ["#","#","#","#","#"],
    "lighting": "",
    "medium": "",
    "mood": "",
    "background_detail": "",
    "moonlight_handling": "",
    "character_proportions": "",
    "forbidden": ["no text", "no photorealism", "no glossy 3d", "no harsh shadows"]
  }
}`;
      try {
        const raw = await ai("google/gemini-2.5-flash", system, user, [eb2!.cover_url as string]);
        const parsed = JSON.parse(raw) as { character_bible: Record<string, unknown>; style_bible: Record<string, unknown> };
        const character_bible_json = { ...parsed.character_bible, locked_at: new Date().toISOString(), anchor: "cover" };
        const style_bible_json = { ...parsed.style_bible, locked_at: new Date().toISOString(), anchor: "cover" };

        // Upsert kids_book_bibles
        if (bible) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db.from("kids_book_bibles") as any).update({
            character_bible_json, style_bible_json,
          }).eq("ebook_id", ebook_id);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db.from("kids_book_bibles") as any).insert({
            ebook_id, character_bible_json, style_bible_json,
          });
        }
        await db.from("ebooks_kids").update({ style_bible_json }).eq("id", ebook_id);
        log.push({ step: "bibles_locked", character: character_bible_json, style: style_bible_json });
        await persistLog();
      } catch (e) {
        log.push({ step: "bibles_locked", error: String((e as Error).message).slice(0, 300) });
        await persistLog();
      }
    }

    // Refresh
    const { data: eb3 } = await db.from("ebooks_kids").select("*").eq("id", ebook_id).single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible3 } = await (db.from("kids_book_bibles") as any)
      .select("*").eq("ebook_id", ebook_id).maybeSingle();

    // ============================================================
    // PHASE 3 — INTERIOR REROLL (all)
    // ============================================================
    if (runAll || phase === "interior") {
      const cb = (bible3?.character_bible_json ?? {}) as Record<string, unknown>;
      const sb = (bible3?.style_bible_json ?? {}) as Record<string, unknown>;

      const charDesc = [
        `named ${cb.name ?? "Luna"}`,
        cb.species && `(${cb.species})`,
        cb.hair_color && cb.hair_style && `${cb.hair_color} ${cb.hair_style} hair`,
        cb.skin_tone_words && `${cb.skin_tone_words} skin`,
        cb.eye_color && cb.eye_shape && `${cb.eye_color} ${cb.eye_shape} eyes`,
        cb.outfit && `wearing ${cb.outfit}`,
        cb.outfit_pattern && `with ${cb.outfit_pattern}`,
        cb.invariant_features && `— ${cb.invariant_features}`,
      ].filter(Boolean).join(", ");

      const styleParts = [
        sb.line_quality && `line quality: ${sb.line_quality}`,
        sb.medium && `medium: ${sb.medium}`,
        sb.lighting && `lighting: ${sb.lighting}`,
        sb.moonlight_handling && `moonlight: ${sb.moonlight_handling}`,
        sb.mood && `mood: ${sb.mood}`,
        Array.isArray(sb.palette) && (sb.palette as string[]).length
          ? `palette: ${(sb.palette as string[]).join(", ")}` : null,
      ].filter(Boolean).join("; ") || "warm whimsical storybook illustration, cozy painterly, soft edges, moonlit glow";

      // Build scenes from page_plan if available; else fall back to plan generator
      const pagePlan = (eb3!.story_bible ?? null) as { spreads?: Array<{ scene?: string; emotion?: string; setting?: string }> } | null;
      let scenes: Array<{ scene: string; emotion: string; setting: string }>;
      if (pagePlan?.spreads && pagePlan.spreads.length >= targetIllos - 2) {
        scenes = pagePlan.spreads.slice(0, targetIllos).map((s) => ({
          scene: s.scene ?? "Luna in a cozy bedtime moment",
          emotion: s.emotion ?? "warm",
          setting: s.setting ?? "moonlit bedroom",
        }));
      } else {
        const plan = await buildScenePlan({
          title: String(eb3!.title ?? ""),
          manuscript_md: String(eb3!.manuscript_md ?? ""),
          min_scenes: targetIllos,
        });
        scenes = plan.scenes.slice(0, targetIllos);
      }

      // Probe whether a reference-conditioned image model is available.
      let strategy: "reference_conditioned" | "unified_text_to_image_family" = "unified_text_to_image_family";
      const coverUrl = eb3!.cover_url as string | null;
      if (coverUrl) {
        try {
          const avail = await isReferenceModelAvailable(coverUrl);
          if (avail) strategy = "reference_conditioned";
        } catch (e) {
          log.push({ step: "reference_probe_error", error: String((e as Error).message).slice(0, 200) });
        }
      }
      log.push({ step: "image_generation_strategy", strategy });

      log.push({ step: "interior_reroll_start", scenes: scenes.length, char: charDesc.slice(0, 160) });
      const records = await renderInteriorIllustrations({
        ebookId: ebook_id, db,
        characterDescription: charDesc,
        styleSuffix: styleParts,
        negativePrompt: "text, watermark, off-model character, wrong outfit, wrong skin tone, wrong hair style, photorealistic, glossy 3d",
        scenes, startPageNumber: 3, concurrency: 3,
        coverReferenceUrl: strategy === "reference_conditioned" ? coverUrl : null,
      });
      await db.from("ebooks_kids").update({
        interior_illustrations: records,
        thumbnail_url: eb3!.cover_url,
        preview_page_urls: records.slice(0, 3).map((r) => r.url),
      }).eq("id", ebook_id);
      const uniqueHashes = new Set(records.map((r) => r.hash)).size;
      log.push({ step: "interior_reroll_done", count: records.length, unique: uniqueHashes, strategy });
        await persistLog();
    }

    // Refresh
    const { data: eb4 } = await db.from("ebooks_kids").select("*").eq("id", ebook_id).single();

    // ============================================================
    // PHASE 4 — RENDER PDF
    // ============================================================
    if (runAll || phase === "pdf") {
      if (!eb4!.cover_url) throw new Error("cover_url missing");
      const illos = Array.isArray(eb4!.interior_illustrations)
        ? eb4!.interior_illustrations as Array<{ url: string; scene?: string }>
        : [];
      if (illos.length === 0) throw new Error("no interior illustrations to build PDF");

      // Pull caption per spread from page_plan or manuscript chunks
      const pagePlan = (eb4!.story_bible ?? null) as { spreads?: Array<{ text?: string }> } | null;
      let captions: string[];
      if (pagePlan?.spreads && pagePlan.spreads.length >= illos.length) {
        captions = pagePlan.spreads.slice(0, illos.length).map((s) => String(s.text ?? "").trim());
      } else {
        const md = String(eb4!.manuscript_md ?? "");
        const paras = md.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
        const chunkSize = Math.max(1, Math.ceil(paras.length / illos.length));
        captions = illos.map((_, i) => paras.slice(i * chunkSize, (i + 1) * chunkSize).join(" "));
      }

      const coverBytes = new Uint8Array(await (await fetch(eb4!.cover_url as string)).arrayBuffer());
      const spreadImages: Uint8Array[] = [];
      for (const il of illos) {
        spreadImages.push(new Uint8Array(await (await fetch(il.url)).arrayBuffer()));
      }
      const pdfBytes = await buildPicturePdf({
        title: String(eb4!.title ?? ""),
        subtitle: (eb4!.subtitle as string | null) ?? null,
        coverPng: coverBytes,
        spreads: illos.map((_, i) => ({ caption: captions[i] || (illos[i].scene ?? ""), imagePng: spreadImages[i] })),
      });
      const path = `kids/${ebook_id}/book.pdf`;
      const up = await db.storage.from("ebook-pdfs").upload(path, pdfBytes, {
        contentType: "application/pdf", upsert: true,
      });
      if (up.error) throw up.error;
      const { data: pub } = await db.storage.from("ebook-pdfs").createSignedUrl(path, 60 * 60 * 24 * 365);
      const pageCount = 2 + illos.length + 1;
      await db.from("ebooks_kids").update({
        pdf_url: pub?.signedUrl ?? null,
        page_count: pageCount,
      }).eq("id", ebook_id);
      log.push({ step: "pdf_rendered", bytes: pdfBytes.length, page_count: pageCount });
        await persistLog();
    }

    // ============================================================
    // PHASE 5 — QC + PUBLISH GATE
    // ============================================================
    let verdict: Record<string, unknown> | null = null;
    let visionReport: unknown = null;
    let storyReport: unknown = null;
    if (runAll || phase === "qc") {
      const qcRes = await fetch(`${SUPABASE_URL}/functions/v1/kids-qc-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id }),
      });
      const qcBody = await qcRes.json();
      verdict = qcBody?.verdict ?? null;
      visionReport = qcBody?.vision_report ?? null;
      storyReport = qcBody?.story_report ?? null;
      log.push({ step: "qc_run", ok: qcRes.ok, sellable: verdict?.sellable, score: verdict?.overall_score, reasons: verdict?.reasons });

      let publishState = "not_attempted";
      if (publish && verdict?.sellable) {
        await db.from("ebooks_kids").update({
          listing_status: "live", status: "live", pipeline_status: "published",
        }).eq("id", ebook_id);
        publishState = "live";
      } else if (verdict?.sellable) {
        publishState = "sellable_but_publish_skipped";
      } else {
        await db.from("ebooks_kids").update({
          listing_status: "draft", status: "needs_revision", pipeline_status: "human_review_required",
        }).eq("id", ebook_id);
        publishState = "draft_needs_review";
      }
      log.push({ step: "publish", state: publishState });
        await persistLog();
    }

    await persistLog({ status: "done" });
  }

  if (runInBackground && typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(runRepair());
    return json({ ok: true, accepted: true, ebook_id, note: "running in background; poll ebooks_kids.qc_scorecard.repair_log" }, 202);
  }
  await runRepair();
  const { data: final } = await db.from("ebooks_kids").select(
    "title, subtitle, cover_url, pdf_url, thumbnail_url, preview_page_urls, interior_illustrations, page_count, word_count, sellable, overall_qc_score, listing_status, pipeline_status, status, qc_scorecard"
  ).eq("id", ebook_id).single();
  return json({ ok: true, ebook_id, log, final, no_shopify: true, no_fake_reviews: true });
});

