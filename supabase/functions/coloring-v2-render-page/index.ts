// coloring-v2-render-page — renders one page then chains to the next.
// When all pages are done, advances to `cover` and fires the cover stage.
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { INTERIOR_NEGATIVE_PROMPT } from "../_shared/coloring-v2/prompts.ts";
import { renderImageWithFallback } from "../_shared/coloring-v2/image-fallback.ts";

declare const Deno: any;

const IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;
const MAX_ATTEMPTS = 2;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id, page_number } = await req.json().catch(() => ({}));
  if (!book_id || !page_number) return json({ error: "book_id + page_number required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "interior_render") return json({ ok: true, skipped: true, stage: book.stage });

    const { data: plan, error: planErr } = await db().from("coloring_v2_page_plans")
      .select("*").eq("book_id", book_id).eq("page_number", page_number).single();
    if (planErr) throw planErr;

    // Skip if this page is already rendered.
    const { data: existing } = await db().from("coloring_v2_assets")
      .select("id").eq("book_id", book_id).eq("page_number", page_number).eq("kind", "interior").maybeSingle();

    let assetId = existing?.id;
    if (!assetId) {
      let lastErr: any = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const bytes = await renderImageWithFallback({
            prompt: plan.prompt,
            negative_prompt: INTERIOR_NEGATIVE_PROMPT,
            model: IDEOGRAM_MODEL,
            width: CANVAS, height: CANVAS,
            num_inference_steps: 8,
            ebook_id: book_id,
            step: `coloring_v2_interior_p${page_number}`,
            v2_book_id: book_id,
            purpose: `interior_p${String(page_number).padStart(2, "0")}_a${attempt}`,
            prompt_version: "v2_page_plan@1",
          });
          const asset = await uploadAsset(book_id, "interior", bytes, "jpg",
            { attempt, prompt_len: plan.prompt.length }, page_number);
          assetId = asset.id;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!assetId) throw lastErr ?? new Error("render failed");
    }

    // Chain: next page or move to cover.
    const nextPage = page_number + 1;
    if (nextPage <= book.page_count) {
      await fireStage("coloring-v2-render-page", { book_id, page_number: nextPage });
      return json({ ok: true, rendered: page_number, next_page: nextPage });
    }

    // All interiors done → cover stage
    await advance(book_id, "interior_render", "cover");
    await fireStage("coloring-v2-cover", { book_id });
    return json({ ok: true, rendered: page_number, next: "cover" });
  } catch (e: any) {
    await recordError(book_id, "interior_render", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
