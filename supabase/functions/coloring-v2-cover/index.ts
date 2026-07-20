// coloring-v2-cover — builds the cover under OWNER LAW `cover_bake_only_v6`.
//
// Architecture (2026-07-21):
//   1. Ideogram bakes EVERYTHING into the illustration itself: the exact
//      title AND a small integrated "Ages X-Y" mark. No SVG/HTML text is
//      ever composited on top afterward.
//   2. Whole-cover OCR gate: only exact title tokens + the age-band tokens
//      are allowed. Any extra chip/ribbon/banner word = reject + retry.
//   3. Up to 5 bake attempts. If all fail, we ship the best attempt (fewest
//      extras) — we NEVER fall back to overlay typography, because overlays
//      always read as a plastered popup.
//
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, signedUrl, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { buildMasterColoringCoverPrompt, COLORING_MASTER_COVER_PROMPT_VERSION } from "../_shared/coloring/master-cover-prompt.ts";
import { getAgeProfile } from "../_shared/coloring-v2/age-matrix.ts";
import { renderImageWithFallback } from "../_shared/coloring-v2/image-fallback.ts";
import { verifyExactCoverText } from "../_shared/coloring/cover-text-transcription.ts";
import { COVER_OVERLAY_CONTRACT } from "../_shared/coloring/premium-cover-overlay.ts";

declare const Deno: any;

const IDEOGRAM_MODEL = "ideogram:4@1";
const CANVAS = 1024;
const BAKE_ATTEMPTS = 5;
const NEGATIVE_PROMPT_BAKE = "any subtitle, any tagline, any 'COLORING BOOK' chip, any 'PAGE' text, any page number, any banner, any ribbon, any sticker, any sale badge, any popup pill, any watermark, any publisher name, any credits, any author line, any letter-shaped ornament, gibberish text, misspelled text, duplicate letters, extra typography, duplicated title, flat vector, line art, black and white, coloring page, uncolored";

function ensureColoringBookInTitle(t: string): string {
  const s = (t ?? "").trim();
  if (!s) return "Coloring Book";
  return /coloring/i.test(s) ? s : `${s} Coloring Book`;
}

function extrasCount(v: any): number {
  return ((v?.extra?.length ?? 0) as number) + ((v?.misspelled_required?.length ?? 0) as number) + ((v?.missing_required?.length ?? 0) as number);
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

    const rawTitle = book.title ?? concept.title ?? "Untitled";
    const title = ensureColoringBookInTitle(rawTitle);
    if (title !== rawTitle) {
      await db().from("coloring_v2_books").update({ title }).eq("id", book_id);
    }
    // OWNER LAW `cover_no_age_badge_v7` (2026-07-21):
    //   Age is shown on the storefront card/product page as a chip. Baking
    //   an "Ages X-Y" mark into the cover art produced awkward floating
    //   circles that broke the composition ("ทำภาพเสีย"). Remove entirely
    //   from V2 covers — the master prompt treats empty ageBadge as omitted
    //   and the OCR verifier will now reject any baked age glyph as extra.
    void prof;
    const ageBadge = "";

    // 3 interior refs (interior-first, cover-last law)
    const { data: interiorAssets } = await db().from("coloring_v2_assets")
      .select("storage_path, page_number").eq("book_id", book_id).eq("kind", "interior")
      .order("page_number", { ascending: true }).limit(3);
    const refs: string[] = [];
    for (const a of (interiorAssets ?? [])) {
      try { refs.push(await signedUrl(a.storage_path, 3600)); } catch { /* skip */ }
    }

    const styleMode = book.cover_mood === "ya_scifi_cinematic" ? "ya_scifi_cinematic" : "default";
    const bakePrompt = buildMasterColoringCoverPrompt({
      title, ageBadge,
      theme: book.theme,
      mainCharacters: (concept.hero_subjects ?? []).slice(0, 3),
      backgroundElements: (concept.motif_inventory ?? []).slice(0, 6),
      aspectDescriptor: "8.5 x 8.5 inches, square 1:1",
      categoryName: book.theme,
      hasInteriorReferences: refs.length > 0,
      styleMode: styleMode as any,
    });

    let passBytes: Uint8Array | null = null;
    let passVerdict: any = null;
    let lastVerdict: any = null;
    let lastErr: any = null;

    for (let attempt = 1; attempt <= BAKE_ATTEMPTS; attempt++) {
      try {
        const candidate = await renderImageWithFallback({
          prompt: bakePrompt, model: IDEOGRAM_MODEL,
          width: CANVAS, height: CANVAS, num_inference_steps: 40,
          negative_prompt: NEGATIVE_PROMPT_BAKE,
          reference_images: refs,
          ebook_id: book_id, step: `coloring_v2_cover_bake_a${attempt}`,
          v2_book_id: book_id, purpose: `cover_bake_a${attempt}`,
          prompt_version: COLORING_MASTER_COVER_PROMPT_VERSION,
        });
        const verdict = await verifyExactCoverText(candidate, { title, subtitle: "", ageBadge });
        lastVerdict = verdict;
        if (verdict.pass) { passBytes = candidate; passVerdict = verdict; break; }
        console.warn(`[coloring-v2-cover] bake attempt ${attempt} rejected: ${verdict.reason} extras=${JSON.stringify(verdict.extra)} misspelled=${JSON.stringify(verdict.misspelled)}`);
      } catch (e) { lastErr = e; console.warn(`[coloring-v2-cover] bake attempt ${attempt} error:`, e?.message ?? e); }
    }

    // OWNER LAW `cover_bake_only_v6_hard_reject` (2026-07-20):
    //   Never ship a cover that failed OCR. Misspellings, extras, hard-banned
    //   tokens, or duplicate age badges = throw. The retry supervisor requeues
    //   the book; garbled typography must never reach the storefront.
    if (!passBytes || !passVerdict?.pass) {
      const reason = lastVerdict?.reason ?? lastErr?.message ?? "unknown";
      throw new Error(`cover_ocr_hard_reject_after_${BAKE_ATTEMPTS}_attempts:${reason}`);
    }

    const asset = await uploadAsset(book_id, "cover_final", passBytes, "jpg", {
      prompt_len: bakePrompt.length, refs: refs.length,
      ocr_verdict: passVerdict.reason,
      ocr_pass: true,
      overlay: COVER_OVERLAY_CONTRACT,
      text_mode: "bake_only",
      prompt_version: COLORING_MASTER_COVER_PROMPT_VERSION,
      law: "cover_bake_only_v6_hard_reject",
    });
    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    await advance(book_id, "cover", "qc");
    await fireStage("coloring-v2-qc", { book_id });
    return json({ ok: true, cover_asset: asset.id, next: "qc", text_mode: "bake_only", ocr: passVerdict.reason });
  } catch (e: any) {
    await recordError(book_id, "cover", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
