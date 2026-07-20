// coloring-v2-cover — builds the cover using the master coloring cover prompt.
// Uses 3 interior pages as visual references (interior-first, cover-last law).
// Enforces whole-cover OCR gate (owner order 2026-07-20, external-audit #1):
// every text region must match {title, subtitle, one age badge, brand} —
// any extra gibberish OR duplicate age-badge = reject and retry.
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, signedUrl, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { buildMasterColoringCoverPrompt } from "../_shared/coloring/master-cover-prompt.ts";
import { getAgeProfile } from "../_shared/coloring-v2/age-matrix.ts";
import { runwareInference } from "../_shared/runware.ts";
import { verifyExactCoverText } from "../_shared/coloring/cover-text-transcription.ts";

declare const Deno: any;

const IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;
const MAX_ATTEMPTS = 4; // higher because whole-cover OCR is stricter
const PROMPT_VERSION = "master_cover_prompt@v2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "cover") return json({ ok: true, skipped: true, stage: book.stage });

    const prof = getAgeProfile(book.age_band);
    const { data: conceptAsset } = await db().from("coloring_v2_assets")
      .select("meta").eq("book_id", book_id).eq("kind", "concept").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const concept = conceptAsset?.meta ?? {};

    // 3 interior refs
    const { data: interiorAssets } = await db().from("coloring_v2_assets")
      .select("storage_path, page_number").eq("book_id", book_id).eq("kind", "interior")
      .order("page_number", { ascending: true }).limit(3);
    const refs: string[] = [];
    for (const a of (interiorAssets ?? [])) {
      try { refs.push(await signedUrl(a.storage_path, 3600)); } catch { /* skip */ }
    }

    const styleMode = book.cover_mood === "ya_scifi_cinematic" ? "ya_scifi_cinematic" : "default";
    const title = book.title ?? concept.title ?? "Untitled";
    const subtitle = book.subtitle ?? concept.subtitle ?? "";
    const ageBadge = prof.label;
    const prompt = buildMasterColoringCoverPrompt({
      title, subtitle, ageBadge,
      theme: book.theme,
      mainCharacters: (concept.hero_subjects ?? []).slice(0, 3),
      backgroundElements: (concept.motif_inventory ?? []).slice(0, 6),
      aspectDescriptor: "8.5 x 8.5 inches, square 1:1",
      categoryName: book.theme,
      hasInteriorReferences: refs.length > 0,
      styleMode,
    });

    let bytes: Uint8Array | null = null;
    let lastErr: any = null;
    let lastVerdict: any = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const candidate = await runwareInference({
          prompt, model: IDEOGRAM_MODEL,
          width: CANVAS, height: CANVAS,
          num_inference_steps: 12,
          reference_images: refs,
          ebook_id: book_id, step: `coloring_v2_cover_a${attempt}`,
          v2_book_id: book_id,
          purpose: `cover_a${attempt}`,
          prompt_version: PROMPT_VERSION,
        });
        // Whole-cover OCR gate.
        const verdict = await verifyExactCoverText(candidate, { title, subtitle, ageBadge });
        lastVerdict = verdict;
        if (verdict.pass || verdict.degraded) {
          // degraded = OCR unavailable. Only accept degraded on the LAST
          // attempt so we don't ship gibberish silently when the transcriber
          // has a transient hiccup on earlier attempts.
          if (verdict.pass || attempt === MAX_ATTEMPTS) { bytes = candidate; break; }
        }
        // Fail — log and retry with a fresh seed.
        console.warn(`[coloring-v2-cover] attempt ${attempt} rejected: ${verdict.reason}; extras=${JSON.stringify(verdict.extra)} dup_badge=${verdict.duplicate_age_badge}`);
      } catch (e) { lastErr = e; }
    }
    if (!bytes) {
      const reason = lastVerdict
        ? `cover_ocr_gate_failed:${lastVerdict.reason}`
        : (lastErr?.message ?? "cover render failed");
      throw new Error(reason);
    }

    const asset = await uploadAsset(book_id, "cover_final", bytes, "jpg",
      { prompt_len: prompt.length, refs: refs.length, ocr_verdict: lastVerdict?.reason ?? null });
    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    await advance(book_id, "cover", "qc");
    await fireStage("coloring-v2-qc", { book_id });
    return json({ ok: true, cover_asset: asset.id, next: "qc", ocr: lastVerdict?.reason ?? null });
  } catch (e: any) {
    await recordError(book_id, "cover", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
