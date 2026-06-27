// Promotes an idea → creates ebook → generates outline → all chapters → marketing
import { corsHeaders, admin, aiJSON, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";

interface Outline { toc: { title: string; brief: string }[]; bonuses: { checklist: string; workbook: string; templates: string; action_plan: string; bonus: string } }
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
      system: `You design premium ebook outlines. Each chapter must deliver a specific transformation, not fluff.`,
      user: `Title: ${idea.title}\nSubtitle: ${idea.subtitle}\nTarget buyer: ${idea.target_buyer}\nHook: ${idea.hook}\n\nDesign a table of contents with EXACTLY 10 chapters. Each chapter should have a specific title (not generic like "Introduction") and a 2-3 sentence brief on what transformation the chapter delivers.\nAlso design these premium bonus sections: a checklist, a worksheet (with prompts), a templates section, and a 7-day action plan.\n\nReturn JSON: { "toc": [{"title": "...", "brief": "..."}, ...10 items], "bonuses": { "checklist": "...", "worksheet": "...", "templates": "...", "action_plan_7day": "..." } }`,
    });
    totalCost += outlineAI.usage.cost_usd;
    await logCost(db, { ebook_id: ebook.id, step: "outline", model: outlineAI.model, ...outlineAI.usage });

    await db.from("ebooks").update({
      toc: outlineAI.data.toc, bonuses: outlineAI.data.bonuses, status: "writing",
    }).eq("id", ebook.id);

    // 2. Generate each chapter (target ~1000 words/chapter)
    const wordsPerChapter = Math.max(800, Math.ceil(minWords / Math.max(outlineAI.data.toc.length, 1)));
    const chapters: { title: string; content: string }[] = [];
    for (const ch of outlineAI.data.toc) {
      const chAI = await aiText({
        model: outlineModel,
        system: `You write premium, useful, plainspoken English ebook chapters. No fluff, no filler, no AI tells. Use specific examples, concrete numbers, and short paragraphs. Markdown allowed (## subheads, bullets, > callouts).`,
        user: `Ebook: "${idea.title}" — ${idea.subtitle}\nReader: ${idea.target_buyer}\n\nWrite Chapter "${ch.title}" (~${wordsPerChapter} words). Brief: ${ch.brief}\n\nDo NOT include the chapter number or the word "Chapter" in the body. Start with a hook paragraph. End with a one-line key takeaway.`,
      });
      chapters.push({ title: ch.title, content: chAI.data });
      totalCost += chAI.usage.cost_usd;
      await logCost(db, { ebook_id: ebook.id, step: `chapter:${ch.title}`.slice(0, 80), model: chAI.model, ...chAI.usage });
    }
    const wordCount = chapters.reduce((s, c) => s + c.content.split(/\s+/).length, 0);

    // 3. Marketing copy
    const mktModel = pickModel(mode, "marketing");
    const mktAI = await aiJSON<Marketing>({
      model: mktModel,
      system: `You write ethical, honest, persuasive product copy for digital ebooks. Use real benefits, never hype. No fake scarcity. No medical/financial guarantees.`,
      user: `Ebook: "${idea.title}" — ${idea.subtitle}\nReader: ${idea.target_buyer}\nHook: ${idea.hook}\nTOC: ${outlineAI.data.toc.map((t) => t.title).join("; ")}\nBonuses: ${Object.values(outlineAI.data.bonuses).join(" | ")}\n\nWrite a Shopify product description in markdown using this structure:\n1) Strong hook\n2) The pain (1-2 sentences)\n3) The transformation (1-2 sentences)\n4) Clear benefits (4-6 bullets)\n5) What's inside (chapter list + bonuses)\n6) Who it's for (3 bullets)\n7) Bonus value\n8) FAQ (3 Q&A)\n9) Strong, honest CTA (no fake urgency)\n\nReturn JSON: { "product_description": "...", "seo_title": "<=60 chars", "seo_meta": "<=160 chars", "tags": ["...", "..."], "cover_prompt": "single-paragraph image-generation prompt that matches: ${cat?.cover_style_prompt ?? "premium minimalist editorial style"}" }`,
    });
    totalCost += mktAI.usage.cost_usd;
    await logCost(db, { ebook_id: ebook.id, step: "marketing", model: mktAI.model, ...mktAI.usage });

    await db.from("ebooks").update({
      chapters, word_count: wordCount,
      product_description: mktAI.data.product_description,
      seo_title: mktAI.data.seo_title, seo_meta: mktAI.data.seo_meta,
      tags: mktAI.data.tags, cover_prompt: mktAI.data.cover_prompt,
      cost_usd: totalCost,
    }).eq("id", ebook.id);

    return new Response(JSON.stringify({ ebook_id: ebook.id, word_count: wordCount, cost_usd: totalCost }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
