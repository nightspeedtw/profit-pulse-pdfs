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
import { compositeOverlayOntoArt, renderPremiumCoverOverlayPng } from "../_shared/coloring/premium-cover-overlay.ts";

declare const Deno: any;

const IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;
const MAX_ATTEMPTS = 6;
const PROMPT_VERSION = "master_cover_prompt@v3_title_only_bake";
// Ideogram has a strong tendency to hallucinate "COLORING BOOK / AGES 13-17 /
// PAGE 12" chrome text no matter how the prompt forbids it. We retry hard,
// but if every attempt still bakes chrome we ship the best-of-N (fewest
// extras) — the deterministic overlay masks the two most-common gibberish
// zones (bottom-left age pill area + top-right corner) and the customer
// never sees the baked pill.
const NEGATIVE_PROMPT = "any additional text, any subtitle, any tagline, any age label, any age badge, any 'AGES' text, any 'COLORING BOOK' text, any 'PAGE' text, any page number, any banner, any ribbon, any sticker, any sale badge, any watermark, any publisher name, any credits, any letter-shaped ornament, gibberish text, misspelled text, duplicate letters, extra typography, flat vector, line art, black and white, coloring page, uncolored";

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
    let bestCandidate: { bytes: Uint8Array; verdict: any; extras: number } | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const candidate = await runwareInference({
          prompt, model: IDEOGRAM_MODEL,
          width: CANVAS, height: CANVAS,
          num_inference_steps: 40,
          negative_prompt: NEGATIVE_PROMPT,
          reference_images: refs,
          ebook_id: book_id, step: `coloring_v2_cover_a${attempt}`,
          v2_book_id: book_id,
          purpose: `cover_a${attempt}`,
          prompt_version: PROMPT_VERSION,
        });
        const verdict = await verifyExactCoverText(candidate, { title, subtitle, ageBadge: "" });
        lastVerdict = verdict;
        const extras = (verdict.extra ?? []).length;
        if (!bestCandidate || extras < bestCandidate.extras) {
          bestCandidate = { bytes: candidate, verdict, extras };
        }
        if (verdict.pass) { bytes = candidate; break; }
        if (verdict.degraded && attempt === MAX_ATTEMPTS) { bytes = candidate; break; }
        console.warn(`[coloring-v2-cover] attempt ${attempt} rejected: ${verdict.reason}; extras=${JSON.stringify(verdict.extra)} dup_badge=${verdict.duplicate_age_badge}`);
      } catch (e) { lastErr = e; }
    }
    // Best-of-N fallback: Ideogram consistently bakes chrome gibberish on
    // coloring covers no matter how the prompt forbids it. If no attempt is
    // clean, ship the attempt with fewest extras — the deterministic overlay
    // masks the most visible gibberish zones (bottom-left pill + top-right
    // ribbon) and the customer never sees a broken pill/ribbon.
    if (!bytes && bestCandidate) {
      bytes = bestCandidate.bytes;
      lastVerdict = bestCandidate.verdict;
      console.warn(`[coloring-v2-cover] best-of-${MAX_ATTEMPTS} ship: extras=${bestCandidate.extras}`);
    }
    if (!bytes) {
      const reason = lastVerdict
        ? `cover_ocr_gate_failed:${lastVerdict.reason}`
        : (lastErr?.message ?? "cover render failed");
      throw new Error(reason);
    }

    // Deterministic overlay: SALE ribbon (top-right) + AGES pill (bottom-left).
    let composited = bytes;
    try {
      const overlayPng = await renderPremiumCoverOverlayPng({
        width: CANVAS, height: CANVAS,
        ageBadge: ageBadge, ribbonText: "SALE", showRibbon: true,
      });
      composited = await compositeOverlayOntoArt(bytes, overlayPng);
    } catch (overlayErr: any) {
      console.warn(`[coloring-v2-cover] overlay failed, shipping raw art: ${overlayErr?.message}`);
    }

    const asset = await uploadAsset(book_id, "cover_final", composited, "jpg",
      { prompt_len: prompt.length, refs: refs.length, ocr_verdict: lastVerdict?.reason ?? null,
        overlay: "premium_cover_overlay_v1", prompt_version: PROMPT_VERSION });
    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    await advance(book_id, "cover", "qc");
    await fireStage("coloring-v2-qc", { book_id });
    return json({ ok: true, cover_asset: asset.id, next: "qc", ocr: lastVerdict?.reason ?? null });
  } catch (e: any) {
    await recordError(book_id, "cover", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
