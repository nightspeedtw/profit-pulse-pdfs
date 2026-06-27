// Promotes an idea → creates ebook → generates outline → all chapters → marketing
import { corsHeaders, admin, aiJSON, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { PREMIUM_WRITER_SYSTEM, HARDSELL_COPYWRITER_SYSTEM } from "../_shared/prompts.ts";

interface Outline { toc: { title: string; brief: string }[]; bonuses: { checklist: string; worksheet: string; templates: string; action_plan_7day: string } }
interface Marketing { product_description: string; seo_title: string; seo_meta: string; tags: string[]; cover_prompt: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id } = await req.json();
    if (!idea_id) throw new Error("idea_id required");

    const { data: idea, error: iErr } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
    if (iErr || !idea) throw new Error("Idea not found");
    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const minWords: number = Number(settings?.min_word_count ?? 18000);

    const { data: cat } = idea.category_id
      ? await db.from("categories").select("*").eq("id", idea.category_id).single()
      : { data: null };
    const price = Number(cat?.default_price ?? 24.99);

    // Create the ebook row
    const { data: ebook, error: eErr } = await db.from("ebooks").insert({
      idea_id: idea.id, category_id: idea.category_id,
      title: idea.title, subtitle: idea.subtitle,
      target_buyer: idea.target_buyer, hook: idea.hook,
      status: "outline", price,
    }).select("*").single();
    if (eErr || !ebook) throw new Error("Failed to create ebook");
    await db.from("ebook_ideas").update({ status: "outline" }).eq("id", idea.id);

    let totalCost = 0;

    // 1. Outline
    const outlineModel = pickModel(mode, "content");
    const outlineAI = await aiJSON<Outline>({
      model: outlineModel,
      system: PREMIUM_WRITER_SYSTEM + `\n\nYou are now designing the ebook OUTLINE. Each chapter must deliver a specific transformation, not fluff. Use 8-12 chapters when the topic supports it; this product asks for exactly 10.`,
      user: `Title: ${idea.title}\nSubtitle: ${idea.subtitle}\nTarget buyer: ${idea.target_buyer}\nHook: ${idea.hook}\n\nDesign a table of contents with EXACTLY 10 chapters. Each chapter title must be specific (not "Introduction") and each brief must be 2-3 sentences naming the transformation that chapter delivers.\nAlso design these premium bonus sections: a checklist, a worksheet (with prompts), a templates section, and a 7-day action plan.\n\nReturn JSON: { "toc": [{"title": "...", "brief": "..."}, ...10 items], "bonuses": { "checklist": "...", "worksheet": "...", "templates": "...", "action_plan_7day": "..." } }`,
    });
    totalCost += outlineAI.usage.cost_usd;
    await logCost(db, { ebook_id: ebook.id, step: "outline", model: outlineAI.model, ...outlineAI.usage });

    await db.from("ebooks").update({
      toc: outlineAI.data.toc, bonuses: outlineAI.data.bonuses, status: "writing",
    }).eq("id", ebook.id);

    // 2. Generate chapters + marketing in background (exceeds 150s sync limit)
    // Aim ~20% over target so the final book reliably clears minWords even if the model under-delivers.
    const wordsPerChapter = Math.max(1800, Math.ceil((minWords * 1.2) / Math.max(outlineAI.data.toc.length, 1)));

    const background = (async () => {
      try {
        const total = outlineAI.data.toc.length;
        const chapters: { title: string; content: string }[] = [];
        let cost = totalCost;

        // Sequential so progress is visible (and to avoid race conditions on writes)
        for (let i = 0; i < total; i++) {
          const ch = outlineAI.data.toc[i];
          // mark which chapter is being written
          await db.from("ebooks").update({
            status: `writing:${i + 1}/${total}`,
          }).eq("id", ebook.id);

          const chAI = await aiText({
            model: outlineModel,
            system: PREMIUM_WRITER_SYSTEM,
            user: `Ebook: "${idea.title}" — ${idea.subtitle}\nReader: ${idea.target_buyer}\nHook: ${idea.hook}\n\nWrite Chapter "${ch.title}". Brief: ${ch.brief}\n\nHARD REQUIREMENT: minimum ${wordsPerChapter} words. Do not stop early. Expand each section with concrete examples, scripts, numbers, and step-by-step detail until you exceed the minimum.\n\nFollow the chapter structure (objective → main teaching → practical example → common mistake → step-by-step → quick checklist → key takeaway). Do NOT include the chapter number or the word "Chapter" in the body. Start with a hook paragraph that names the reader's specific pain. End with a one-line key takeaway.`,
          });
          await logCost(db, { ebook_id: ebook.id, step: `chapter:${ch.title}`.slice(0, 80), model: chAI.model, ...chAI.usage });
          chapters.push({ title: ch.title, content: chAI.data });
          cost += chAI.usage.cost_usd;

          // Stream progress to DB after each chapter completes
          const wc = chapters.reduce((s, c) => s + c.content.split(/\s+/).length, 0);
          await db.from("ebooks").update({
            chapters, word_count: wc, cost_usd: cost,
            status: i + 1 < total ? `writing:${i + 1}/${total}` : `marketing`,
          }).eq("id", ebook.id);
        }

        const wordCount = chapters.reduce((s, c) => s + c.content.split(/\s+/).length, 0);

        // 3. Marketing copy
        const mktModel = pickModel(mode, "marketing");
        const mktAI = await aiJSON<Marketing>({
          model: mktModel,
          system: HARDSELL_COPYWRITER_SYSTEM + `\n\nYou are now writing the Shopify product page copy for a finished premium PDF ebook. Use ethical hard-sell copywriting: name the pain, show the cost of doing nothing, frame the transformation, and handle objections — but no fake scarcity, no guaranteed outcomes.`,
          user: `Ebook: "${idea.title}" — ${idea.subtitle}\nReader: ${idea.target_buyer}\nHook: ${idea.hook}\nTOC: ${outlineAI.data.toc.map((t) => t.title).join("; ")}\nBonuses: ${Object.values(outlineAI.data.bonuses).join(" | ")}\n\nWrite a Shopify product description in markdown using this structure:\n1) Hard-sell hook (1-2 sentences that name the buyer's pain)\n2) The cost of doing nothing (1-2 sentences)\n3) The transformation (1-2 sentences — believable, not guaranteed)\n4) Clear benefits (4-6 bullets)\n5) What's inside (chapter list + bonuses)\n6) Who it's for (3 bullets)\n7) Objection handling (3 short Q&A: "Too expensive?", "Can't I find this free?", "I don't have time")\n8) Bonus value\n9) Honest CTA (no fake urgency)\n\nReturn JSON: { "product_description": "...", "seo_title": "<=60 chars", "seo_meta": "<=160 chars", "tags": ["...","..."], "cover_prompt": "single-paragraph image-generation prompt that matches: ${cat?.cover_style_prompt ?? "premium minimalist editorial style"}" }`,
        });
        cost += mktAI.usage.cost_usd;
        await logCost(db, { ebook_id: ebook.id, step: "marketing", model: mktAI.model, ...mktAI.usage });

        await db.from("ebooks").update({
          chapters, word_count: wordCount,
          product_description: mktAI.data.product_description,
          seo_title: mktAI.data.seo_title, seo_meta: mktAI.data.seo_meta,
          tags: mktAI.data.tags, cover_prompt: mktAI.data.cover_prompt,
          cost_usd: cost, status: "ready_for_qc",
        }).eq("id", ebook.id);
      } catch (err) {
        console.error("background generation failed:", err);
        await db.from("ebooks").update({ status: "failed" }).eq("id", ebook.id);
      }
    })();



    // @ts-ignore - EdgeRuntime is available in Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(background);

    return new Response(JSON.stringify({ ebook_id: ebook.id, status: "writing", async: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

