// coloring-v2-concept — generates title/subtitle/hero/motifs.
// @ts-nocheck
import { advance, callAiJson, corsHeaders, db, fetchBook, fireStage, json, recordError } from "../_shared/coloring-v2/state.ts";
import { buildConceptPrompt, CONCEPT_SYSTEM } from "../_shared/coloring-v2/prompts.ts";

declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (!["queued", "concept"].includes(book.stage)) return json({ ok: true, skipped: true, stage: book.stage });

    const concept = await callAiJson(
      buildConceptPrompt(book.theme, book.age_band, book.page_count),
      CONCEPT_SYSTEM,
    );
    if (!concept?.title || typeof concept.title !== "string") {
      throw new Error("concept missing title");
    }

    await db().from("coloring_v2_books").update({
      title: concept.title.trim(),
      subtitle: (concept.subtitle ?? "").toString().trim() || null,
    }).eq("id", book_id);

    await db().from("coloring_v2_assets").insert({
      book_id, kind: "concept", storage_path: `${book_id}/concept.json`,
      meta: concept, mime: "application/json",
    });

    const ok = await advance(book_id, "queued", "style_bible");
    if (!ok) await advance(book_id, "concept", "style_bible");
    await fireStage("coloring-v2-style-bible", { book_id });
    return json({ ok: true, next: "style_bible", concept });
  } catch (e: any) {
    await recordError(book_id, "concept", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
