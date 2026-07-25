// coloring-v2-concept — generates title/subtitle/hero/motifs.
// @ts-nocheck
import { acquireColoringV2ProductionLock, advance, callAiJson, chainOwnerMatches, corsHeaders, db, fetchBook, fireStage, json, recordError } from "../_shared/coloring-v2/state.ts";
import { buildConceptPrompt, CONCEPT_SYSTEM } from "../_shared/coloring-v2/prompts.ts";
import { violatesFullCoverage } from "../_shared/coloring/full-coverage-law.ts";


declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id, chain_owner_book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    if (!chainOwnerMatches(book_id, chain_owner_book_id)) return json({ ok: true, skipped: true, reason: "chain_owner_mismatch" });
    const lock = await acquireColoringV2ProductionLock(book_id);
    if (!lock.acquired) return json({ ok: true, waiting_for_lock: true, holder: lock.holder, expires_at: lock.expires_at });

    const book = await fetchBook(book_id);
    if (!["queued", "concept"].includes(book.stage)) return json({ ok: true, skipped: true, stage: book.stage });

    const concept = await callAiJson(
      buildConceptPrompt(book.theme, book.age_band, book.page_count),
      CONCEPT_SYSTEM,
    );
    if (!concept?.title || typeof concept.title !== "string") {
      throw new Error("concept missing title");
    }

    // OWNER LAW `cover_text_overlay_only_v2` — every coloring book title
    // MUST contain the words "Coloring Book" so shoppers instantly know the
    // product category. Non-destructive: appended only if missing.
    const rawTitle = concept.title.trim();
    const finalTitle = /coloring/i.test(rawTitle) ? rawTitle : `${rawTitle} Coloring Book`;

    await db().from("coloring_v2_books").update({
      title: finalTitle,
      subtitle: (concept.subtitle ?? "").toString().trim() || null,
    }).eq("id", book_id);

    await db().from("coloring_v2_assets").insert({
      book_id, kind: "concept", storage_path: `${book_id}/concept.json`,
      meta: concept, mime: "application/json",
    });

    const ok = await advance(book_id, "queued", "style_bible");
    if (!ok) await advance(book_id, "concept", "style_bible");
    await fireStage("coloring-v2-style-bible", { book_id, chain_owner_book_id: book_id });
    return json({ ok: true, next: "style_bible", concept });
  } catch (e: any) {
    const book = await fetchBook(book_id).catch(() => null);
    await recordError(book_id, book?.stage === "queued" ? "queued" : "concept", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
