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
import { verifyExactCoverText } from "../_shared/coloring/cover-text-transcription.ts";
import { COVER_OVERLAY_CONTRACT } from "../_shared/coloring/premium-cover-overlay.ts";
import { geminiDirectImageWithMeta } from "../_shared/gemini-direct.ts";
import { openaiDirectImage } from "../_shared/openai-direct.ts";

declare const Deno: any;

const IDEOGRAM_MODEL = "ideogram:4@1";
// Google native API (generativelanguage.googleapis.com) image model IDs.
// `gemini-3-pro-image` is a Lovable-Gateway alias; the direct API accepts
// `gemini-2.5-flash-image` (a.k.a. Nano Banana). Using the wrong ID on
// direct returns 404 instantly, which is why prior attempts silently
// skipped Gemini and jumped straight to Runware.
const GEMINI_IMAGE_MODEL = "google/gemini-2.5-flash-image";
const OPENAI_IMAGE_MODEL = "gpt-image-1";
const CANVAS = 1024;
const BAKE_ATTEMPTS = 3;
const NEGATIVE_PROMPT_BAKE = "any subtitle, any tagline, any 'COLORING BOOK' chip, any 'PAGE' text, any page number, any banner, any ribbon, any sticker, any sale badge, any popup pill, any watermark, any publisher name, any credits, any author line, any letter-shaped ornament, gibberish text, misspelled text, duplicate letters, extra typography, duplicated title, flat vector, line art, black and white, coloring page, uncolored";

type CoverProvider = "gemini" | "openai";

async function logProvider(book_id: string, provider: string, model: string, purpose: string, success: boolean, err: string | null, latency_ms: number) {
  try {
    await db().from("coloring_v2_provider_calls").insert({
      book_id, provider, model, purpose,
      prompt_version: COLORING_MASTER_COVER_PROMPT_VERSION,
      success, error_message: err?.slice(0, 500) ?? null, latency_ms,
    });
  } catch (_) { /* observability best-effort */ }
}

// OWNER LAW `cover_uses_gemini_openai_primary_v8` (2026-07-21, fixed 2026-07-21):
//   Cover bake priority: Gemini image (direct) → OpenAI gpt-image (direct)
//   → Runware/Ideogram → Cloudflare (last-resort). Each attempt is logged
//   to coloring_v2_provider_calls so we can see WHY a provider was skipped.
async function renderCoverBake(opts: any, attempt: number, book_id: string): Promise<{ bytes: Uint8Array; provider: CoverProvider }> {
  // 1. Gemini native image (google_direct)
  {
    const t0 = Date.now();
    try {
      const { bytes, meta } = await geminiDirectImageWithMeta({
        prompt: opts.prompt,
        referenceUrls: opts.reference_images ?? [],
        model: GEMINI_IMAGE_MODEL,
      });
      if (bytes.length > 0) {
        await logProvider(book_id, meta.provider, meta.model, `cover_bake_a${attempt}_gemini`, true, null, Date.now() - t0);
        return { bytes, provider: "gemini" };
      }
      await logProvider(book_id, meta.provider, meta.model, `cover_bake_a${attempt}_gemini`, false, `empty_bytes:${meta.finishReason ?? meta.blockReason ?? "no_image"}`, Date.now() - t0);
      console.warn("[coloring-v2-cover] gemini returned empty image, trying openai");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await logProvider(book_id, "google_direct", GEMINI_IMAGE_MODEL, `cover_bake_a${attempt}_gemini`, false, msg, Date.now() - t0);
      console.warn(`[coloring-v2-cover] gemini failed: ${msg.slice(0, 300)}`);
    }
  }
  // 2. OpenAI gpt-image direct
  {
    const t0 = Date.now();
    try {
      const { bytes } = await openaiDirectImage({
        prompt: opts.prompt,
        model: OPENAI_IMAGE_MODEL,
        size: "1024x1024",
        quality: "high",
      });
      if (bytes.length > 0) {
        await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_bake_a${attempt}_openai`, true, null, Date.now() - t0);
        return { bytes, provider: "openai" };
      }
      await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_bake_a${attempt}_openai`, false, "empty_bytes", Date.now() - t0);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_bake_a${attempt}_openai`, false, msg, Date.now() - t0);
      console.warn(`[coloring-v2-cover] openai-image failed: ${msg.slice(0, 300)}`);
    }
  }
  // 3. Runware/Ideogram fallback (already logs internally)
  try {
    const bytes = await runwareInference(opts);
    return { bytes, provider: "runware" };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "");
    const billingLocked = /insufficient|balance|credit|billing|payment required|402/i.test(msg);
    if (!billingLocked) throw e;
    console.warn(`[coloring-v2-cover] runware billing-locked; CF last-resort: ${msg.slice(0, 200)}`);
    const bytes = await renderImageWithFallback(opts);
    return { bytes, provider: "cloudflare_fallback" };
  }
}

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
    let bestBytes: Uint8Array | null = null;
    let bestExtras = Number.POSITIVE_INFINITY;
    let bestVerdict: any = null;
    let bestProvider: CoverProvider | null = null;
    let transcriberFailures = 0;

    for (let attempt = 1; attempt <= BAKE_ATTEMPTS; attempt++) {
      try {
        const { bytes: candidate, provider } = await renderCoverBake({
          prompt: bakePrompt, model: IDEOGRAM_MODEL,
          width: CANVAS, height: CANVAS, num_inference_steps: 40,
          negative_prompt: NEGATIVE_PROMPT_BAKE,
          reference_images: refs,
          ebook_id: book_id, step: `coloring_v2_cover_bake_a${attempt}`,
          v2_book_id: book_id, purpose: `cover_bake_a${attempt}`,
          prompt_version: COLORING_MASTER_COVER_PROMPT_VERSION,
        }, attempt, book_id);
        const verdict = await verifyExactCoverText(candidate, { title, subtitle: "", ageBadge });
        lastVerdict = verdict;
        if (verdict.pass) { passBytes = candidate; passVerdict = verdict; break; }
        const reasonStr = String(verdict.reason ?? "");
        // Track transcriber-unavailable separately: if OCR itself is down, we
        // cannot punish the bake — record and keep the first candidate as
        // best so we can soft-ship after the cap.
        if (/transcriber_unavailable|transcriber_error/i.test(reasonStr)) {
          transcriberFailures++;
          if (!bestBytes) { bestBytes = candidate; bestExtras = 0; bestVerdict = verdict; bestProvider = provider; }
        } else {
          const extras = extrasCount(verdict);
          if (extras < bestExtras) { bestBytes = candidate; bestExtras = extras; bestVerdict = verdict; bestProvider = provider; }
        }
        console.warn(`[coloring-v2-cover] bake attempt ${attempt} (${provider}) rejected: ${verdict.reason} extras=${JSON.stringify(verdict.extra)} misspelled=${JSON.stringify(verdict.misspelled)}`);
      } catch (e) { lastErr = e; console.warn(`[coloring-v2-cover] bake attempt ${attempt} error:`, e?.message ?? e); }
    }

    // OWNER LAW `cover_bake_only_v6_hard_reject` (amended 2026-07-20):
    //   • Strict pass = ship.
    //   • Transcriber unavailable on ALL attempts = SOFT-ACCEPT best attempt.
    //     Vision provider outage must not stall the book or bleed quota.
    //   • Cloudflare fallback path = SOFT-ACCEPT (CF typography is weaker
    //     than Ideogram; we already logged the degradation).
    //   • Otherwise = hard reject (garbled Ideogram title stays blocked).
    let softAcceptReason: string | null = null;
    if (!passBytes || !passVerdict?.pass) {
      if (transcriberFailures >= BAKE_ATTEMPTS && bestBytes) {
        passBytes = bestBytes; passVerdict = bestVerdict;
        softAcceptReason = "soft_accept_transcriber_unavailable_all_attempts";
      } else if (bestProvider === "cloudflare_fallback" && bestBytes) {
        passBytes = bestBytes; passVerdict = bestVerdict;
        softAcceptReason = "soft_accept_cf_fallback_runware_billing_locked";
      } else {
        const reason = lastVerdict?.reason ?? lastErr?.message ?? "unknown";
        throw new Error(`cover_ocr_hard_reject_after_${BAKE_ATTEMPTS}_attempts:${reason}`);
      }
    }

    const asset = await uploadAsset(book_id, "cover_final", passBytes, "jpg", {
      prompt_len: bakePrompt.length, refs: refs.length,
      ocr_verdict: passVerdict?.reason ?? "n/a",
      ocr_pass: !softAcceptReason,
      ocr_soft_accept: softAcceptReason,
      overlay: COVER_OVERLAY_CONTRACT,
      text_mode: "bake_only",
      prompt_version: COLORING_MASTER_COVER_PROMPT_VERSION,
      law: "cover_uses_gemini_openai_primary_v8",
    });
    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    await advance(book_id, "cover", "qc");
    await fireStage("coloring-v2-qc", { book_id });
    return json({ ok: true, cover_asset: asset.id, next: "qc", text_mode: "bake_only", ocr: passVerdict?.reason, soft_accept: softAcceptReason });
  } catch (e: any) {
    await recordError(book_id, "cover", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
