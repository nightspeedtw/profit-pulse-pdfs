// Resume a stuck ebook generation. Picks up from the current chapter count
// and re-runs chapter writing + marketing the same way promote-idea does.
import { corsHeaders, admin, aiJSON, aiText, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";

interface Marketing { product_description: string; seo_title: string; seo_meta: string; tags: string[]; cover_prompt: string }
interface TocItem { title: string; brief: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: ebook, error } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (error || !ebook) throw new Error("Ebook not found");

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";
    const minWords: number = Number(settings?.min_word_count ?? 18000);

    const toc: TocItem[] = Array.isArray(ebook.toc) ? ebook.toc as TocItem[] : [];
    if (toc.length === 0) throw new Error("No outline yet — cannot resume. Re-run promote-idea.");

    const { data: cat } = ebook.category_id
      ? await db.from("categories").select("*").eq("id", ebook.category_id).single()
      : { data: null };

    const existing: { title: string; content: string }[] = Array.isArray(ebook.chapters) ? ebook.chapters as { title: string; content: string }[] : [];
    const startIdx = existing.length;
    const total = toc.length;
    const writeModel = pickModel(mode, "content");
    const wordsPerChapter = Math.max(1500, Math.min(1800, Math.ceil(minWords / Math.max(total, 1))));

    const background = (async () => {
      try {
        const chapters = [...existing];
        let cost = Number(ebook.cost_usd ?? 0);

        for (let i = startIdx; i < total; i++) {
          const ch = toc[i];
          await db.from("ebooks").update({ status: `writing:${i + 1}/${total}` }).eq("id", ebook.id);

          const chAI = await aiText({
            model: writeModel,
            system: `You write premium, useful, plainspoken English ebook chapters. No fluff, no filler, no AI tells. Use specific examples, concrete numbers, and short paragraphs. Markdown allowed (## subheads, bullets, > callouts).`,
            user: `Ebook: "${ebook.title}" — ${ebook.subtitle ?? ""}\nReader: ${ebook.target_buyer ?? ""}\n\nWrite Chapter "${ch.title}" (~${wordsPerChapter} words). Brief: ${ch.brief}\n\nDo NOT include the chapter number or the word "Chapter" in the body. Start with a hook paragraph. End with a one-line key takeaway.`,
          });
          await logCost(db, { ebook_id: ebook.id, step: `chapter:${ch.title}`.slice(0, 80), model: chAI.model, ...chAI.usage });
          chapters.push({ title: ch.title, content: chAI.data });
          cost += chAI.usage.cost_usd;

          const wc = chapters.reduce((s, c) => s + c.content.split(/\s+/).length, 0);
          await db.from("ebooks").update({
            chapters, word_count: wc, cost_usd: cost,
            status: i + 1 < total ? `writing:${i + 1}/${total}` : `marketing`,
          }).eq("id", ebook.id);
        }

        const wordCount = chapters.reduce((s, c) => s + c.content.split(/\s+/).length, 0);

        // Marketing copy (skip if already present)
        if (!ebook.product_description) {
          const mktModel = pickModel(mode, "marketing");
          const mktAI = await aiJSON<Marketing>({
            model: mktModel,
            system: `You write ethical, honest, persuasive product copy for digital ebooks. Use real benefits, never hype. No fake scarcity. No medical/financial guarantees.`,
            user: `Ebook: "${ebook.title}" — ${ebook.subtitle ?? ""}\nReader: ${ebook.target_buyer ?? ""}\nHook: ${ebook.hook ?? ""}\nTOC: ${toc.map((t) => t.title).join("; ")}\n\nWrite a Shopify product description in markdown using this structure:\n1) Strong hook\n2) The pain\n3) The transformation\n4) Clear benefits (4-6 bullets)\n5) What's inside (chapter list + bonuses)\n6) Who it's for (3 bullets)\n7) Bonus value\n8) FAQ (3 Q&A)\n9) Strong honest CTA.\n\nReturn JSON: { "product_description": "...", "seo_title": "<=60 chars", "seo_meta": "<=160 chars", "tags": ["...","..."], "cover_prompt": "single-paragraph cover prompt matching: ${cat?.cover_style_prompt ?? "premium minimalist editorial style"}" }`,
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
        } else {
          await db.from("ebooks").update({
            chapters, word_count: wordCount, cost_usd: cost, status: "ready_for_qc",
          }).eq("id", ebook.id);
        }
      } catch (err) {
        console.error("resume-generation failed:", err);
        await db.from("ebooks").update({ status: "failed" }).eq("id", ebook.id);
      }
    })();

    // @ts-ignore - EdgeRuntime is available in Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(background);

    return new Response(JSON.stringify({ ok: true, resumed_from: startIdx, total }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
