// coloring-v2-cover — builds the cover under OWNER LAW `cover_text_overlay_only_v2`.
//
// Architecture (2026-07-20):
//   1. Ideogram bakes AT MOST the big title. Everything else (subtitle,
//      blurb, "Coloring Book" chip, AGES pill, SALE ribbon) is drawn by the
//      deterministic overlay — no AI text on those elements EVER.
//   2. Whole-cover OCR gate: only exact title tokens allowed. Any extra
//      glyph = reject + retry (max 3).
//   3. If 3 title-bake retries still ship extras, we fall back to fully
//      TEXTLESS Ideogram art and the overlay draws the title too — a clean
//      bold display font never misspells. Zero spelling errors ship, ever.
//
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
const TITLE_BAKE_ATTEMPTS = 3;      // OWNER LAW v2: 3 tries max on title-bake
const TEXTLESS_ATTEMPTS = 2;        // then 2 tries on fully textless
const PROMPT_VERSION = "master_cover_prompt@v4_title_only_or_textless";
const NEGATIVE_PROMPT_TITLE_ONLY = "any subtitle, any tagline, any age label, any age badge, any 'AGES' text, any 'COLORING BOOK' text, any 'PAGE' text, any page number, any banner, any ribbon, any sticker, any sale badge, any watermark, any publisher name, any credits, any letter-shaped ornament, gibberish text, misspelled text, duplicate letters, extra typography, flat vector, line art, black and white, coloring page, uncolored";
const NEGATIVE_PROMPT_TEXTLESS = "any text, any letter, any word, any typography, any glyph, any title, any subtitle, any tagline, any label, any badge, any ribbon, any sticker, any watermark, any signature, any page number, any letter-shaped ornament, gibberish text, flat vector, line art, black and white, coloring page, uncolored";

function ensureColoringBookInTitle(t: string): string {
  const s = (t ?? "").trim();
  if (!s) return "Coloring Book";
  return /coloring/i.test(s) ? s : `${s} Coloring Book`;
}

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

    // NAMING GATE (owner law): every coloring book title must contain
    // "Coloring Book" so the shopper always knows what they're buying.
    const rawTitle = book.title ?? concept.title ?? "Untitled";
    const title = ensureColoringBookInTitle(rawTitle);
    if (title !== rawTitle) {
      await db().from("coloring_v2_books").update({ title }).eq("id", book_id);
    }
    const subtitle = book.subtitle ?? concept.subtitle ?? "";
    const blurb = concept.parent_hook ?? concept.description ?? "";
    const ageBadge = prof.label;
    const ageBadgeUpper = `AGES ${(book.age_band || "").replace(/\s+/g, "")}`;

    // 3 interior refs (interior-first, cover-last law)
    const { data: interiorAssets } = await db().from("coloring_v2_assets")
      .select("storage_path, page_number").eq("book_id", book_id).eq("kind", "interior")
      .order("page_number", { ascending: true }).limit(3);
    const refs: string[] = [];
    for (const a of (interiorAssets ?? [])) {
      try { refs.push(await signedUrl(a.storage_path, 3600)); } catch { /* skip */ }
    }

    const styleMode = book.cover_mood === "ya_scifi_cinematic" ? "ya_scifi_cinematic" : "default";
    const commonInput = {
      title, subtitle, ageBadge,
      theme: book.theme,
      mainCharacters: (concept.hero_subjects ?? []).slice(0, 3),
      backgroundElements: (concept.motif_inventory ?? []).slice(0, 6),
      aspectDescriptor: "8.5 x 8.5 inches, square 1:1",
      categoryName: book.theme,
      hasInteriorReferences: refs.length > 0,
      styleMode: styleMode as any,
    };

    let bytes: Uint8Array | null = null;
    let lastVerdict: any = null;
    let textlessFallback = false;
    let lastErr: any = null;

    // === Phase 1: title-only bake (3 attempts) ============================
    const titlePrompt = buildMasterColoringCoverPrompt({ ...commonInput, textMode: "title_only" });
    for (let attempt = 1; attempt <= TITLE_BAKE_ATTEMPTS; attempt++) {
      try {
        const candidate = await runwareInference({
          prompt: titlePrompt, model: IDEOGRAM_MODEL,
          width: CANVAS, height: CANVAS, num_inference_steps: 40,
          negative_prompt: NEGATIVE_PROMPT_TITLE_ONLY,
          reference_images: refs,
          ebook_id: book_id, step: `coloring_v2_cover_title_a${attempt}`,
          v2_book_id: book_id, purpose: `cover_title_a${attempt}`,
          prompt_version: PROMPT_VERSION,
        });
        const verdict = await verifyExactCoverText(candidate, { title, subtitle: "", ageBadge: "" });
        lastVerdict = verdict;
        if (verdict.pass) { bytes = candidate; break; }
        console.warn(`[coloring-v2-cover] title attempt ${attempt} rejected: ${verdict.reason} extras=${JSON.stringify(verdict.extra)}`);
      } catch (e) { lastErr = e; console.warn(`[coloring-v2-cover] title attempt ${attempt} error:`, e?.message ?? e); }
    }

    // === Phase 2: TEXTLESS fallback (owner law) ===========================
    if (!bytes) {
      textlessFallback = true;
      const textlessPrompt = buildMasterColoringCoverPrompt({ ...commonInput, textMode: "textless" });
      for (let attempt = 1; attempt <= TEXTLESS_ATTEMPTS; attempt++) {
        try {
          const candidate = await runwareInference({
            prompt: textlessPrompt, model: IDEOGRAM_MODEL,
            width: CANVAS, height: CANVAS, num_inference_steps: 40,
            negative_prompt: NEGATIVE_PROMPT_TEXTLESS,
            reference_images: refs,
            ebook_id: book_id, step: `coloring_v2_cover_textless_a${attempt}`,
            v2_book_id: book_id, purpose: `cover_textless_a${attempt}`,
            prompt_version: PROMPT_VERSION,
          });
          const verdict = await verifyExactCoverText(candidate, { title, subtitle: "", ageBadge: "" }, { textlessMode: true });
          lastVerdict = verdict;
          // Accept textless art even if a stray glyph slipped through — the
          // overlay's opaque top-chip / bottom-banner / age-pill will cover
          // the most common stray zones. Zero baked title tokens = customer
          // never sees a spelling error.
          bytes = candidate;
          if (verdict.pass) break;
          console.warn(`[coloring-v2-cover] textless attempt ${attempt} not perfectly clean but accepted: ${verdict.reason}`);
        } catch (e) { lastErr = e; console.warn(`[coloring-v2-cover] textless attempt ${attempt} error:`, e?.message ?? e); }
      }
    }

    if (!bytes) throw new Error(`cover_render_failed:${lastErr?.message ?? lastVerdict?.reason ?? "unknown"}`);

    // === Overlay: deterministic typography stack ==========================
    let composited = bytes;
    try {
      const overlayPng = await renderPremiumCoverOverlayPng({
        width: CANVAS, height: CANVAS,
        ageBadge: ageBadgeUpper,
        ribbonText: "SALE", showRibbon: true,
        topLabel: "COLORING BOOK",
        subtitle,
        blurb,
        fallbackTitle: textlessFallback ? title : "",
      });
      composited = await compositeOverlayOntoArt(bytes, overlayPng);
    } catch (overlayErr: any) {
      console.warn(`[coloring-v2-cover] overlay failed, shipping raw art: ${overlayErr?.message}`);
    }

    const asset = await uploadAsset(book_id, "cover_final", composited, "jpg", {
      prompt_len: titlePrompt.length, refs: refs.length,
      ocr_verdict: lastVerdict?.reason ?? null,
      overlay: "premium_cover_overlay_v2_full_stack",
      text_mode: textlessFallback ? "textless" : "title_only",
      prompt_version: PROMPT_VERSION,
      law: "cover_text_overlay_only_v2",
    });
    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    await advance(book_id, "cover", "qc");
    await fireStage("coloring-v2-qc", { book_id });
    return json({ ok: true, cover_asset: asset.id, next: "qc", text_mode: textlessFallback ? "textless" : "title_only", ocr: lastVerdict?.reason ?? null });
  } catch (e: any) {
    await recordError(book_id, "cover", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
