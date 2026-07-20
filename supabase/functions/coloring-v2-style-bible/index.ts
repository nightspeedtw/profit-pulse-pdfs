// coloring-v2-style-bible — generates the style bible.
// @ts-nocheck
import { advance, callAiJson, corsHeaders, db, fetchBook, fireStage, json, recordError } from "../_shared/coloring-v2/state.ts";
import { buildStyleBiblePrompt, STYLE_BIBLE_SYSTEM } from "../_shared/coloring-v2/prompts.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "style_bible") return json({ ok: true, skipped: true, stage: book.stage });

    // Load concept
    const { data: conceptAsset } = await db().from("coloring_v2_assets")
      .select("meta").eq("book_id", book_id).eq("kind", "concept").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const concept = conceptAsset?.meta ?? { title: book.title };

    const bible = await callAiJson(buildStyleBiblePrompt(concept, book.age_band), STYLE_BIBLE_SYSTEM);
    await db().from("coloring_v2_style_bibles").insert({ book_id, bible });

    await advance(book_id, "style_bible", "page_plan");
    await fireStage("coloring-v2-page-plan", { book_id });
    return json({ ok: true, next: "page_plan" });
  } catch (e: any) {
    await recordError(book_id, "style_bible", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
