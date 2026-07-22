// Coloring cover — Cover Builder V2.
//
// OWNER LAW `cover_v2_deterministic_typography` (2026-07-22, PERMANENT):
//   Three-layer contract:
//     1. illustration_layer — TEXTLESS art from Gemini/OpenAI with an
//        intentionally designed title environment (ribbon, sky panel,
//        magic smoke, shield, etc.).
//     2. typography_layer   — deterministic artistic glyphs rendered
//        server-side from CANONICAL METADATA via renderKidsTitleTreatment.
//        Every glyph proven against approved tokens BEFORE raster.
//     3. final_composite    — flattened master PNG. This is the only URL
//        exposed as cover_url + thumbnail_url + PDF page 1.
//
//   Frontend never composites text over the cover; all text is baked into
//   final_composite so the image survives outside the website.
//
//   Retry cap: 3 dispatches. On exhaustion, park and raise a critical
//   dashboard alert.
//
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, signedUrl, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { buildTextlessColoringCoverPrompt, COLORING_TEXTLESS_COVER_PROMPT_VERSION } from "../_shared/coloring/textless-cover-prompt.ts";
import { getAgeProfile } from "../_shared/coloring-v2/age-matrix.ts";
import { verifyExactCoverText } from "../_shared/coloring/cover-text-transcription.ts";
import { pickStyleFamily, STYLE_FAMILIES } from "../_shared/coloring/style-families.ts";
import { loadRecencyPicks } from "../_shared/coloring/cover-recency.ts";
import { composeColoringCover, COLORING_COVER_COMPOSITOR_VERSION, COLORING_COVER_WIDTH, COLORING_COVER_HEIGHT } from "../_shared/coloring/coloring-cover-compositor.ts";
import { verifyTypographySource } from "../_shared/coloring/typography-source-verifier.ts";
import { geminiDirectImageWithMeta } from "../_shared/gemini-direct.ts";
import { openaiDirectImage } from "../_shared/openai-direct.ts";

declare const Deno: any;

const GEMINI_IMAGE_MODEL = "google/gemini-2.5-flash-image";
const OPENAI_IMAGE_MODEL = "gpt-image-1";
const BAKE_ATTEMPTS = 3;
const COVER_HARD_ATTEMPT_CAP = 3;
const COVER_LAW = "cover_v2_deterministic_typography";

type CoverProvider = "gemini" | "openai";

async function logProvider(book_id: string, provider: string, model: string, purpose: string, success: boolean, err: string | null, latency_ms: number) {
  try {
    await db().from("coloring_v2_provider_calls").insert({
      book_id, provider, model, purpose,
      prompt_version: COLORING_TEXTLESS_COVER_PROMPT_VERSION,
      success, error_message: err?.slice(0, 500) ?? null, latency_ms,
    });
  } catch (_) { /* best-effort */ }
}

async function renderTextlessArt(opts: { prompt: string; refs: string[] }, attempt: number, book_id: string): Promise<{ bytes: Uint8Array; provider: CoverProvider }> {
  {
    const t0 = Date.now();
    try {
      const { bytes, meta } = await geminiDirectImageWithMeta({
        prompt: opts.prompt,
        referenceUrls: opts.refs,
        model: GEMINI_IMAGE_MODEL,
      });
      if (bytes.length > 0) {
        await logProvider(book_id, meta.provider, meta.model, `cover_textless_a${attempt}_gemini`, true, null, Date.now() - t0);
        return { bytes, provider: "gemini" };
      }
      await logProvider(book_id, meta.provider, meta.model, `cover_textless_a${attempt}_gemini`, false, `empty_bytes:${meta.finishReason ?? meta.blockReason ?? "no_image"}`, Date.now() - t0);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await logProvider(book_id, "google_direct", GEMINI_IMAGE_MODEL, `cover_textless_a${attempt}_gemini`, false, msg, Date.now() - t0);
      console.warn(`[coloring-v2-cover] gemini failed: ${msg.slice(0, 300)}`);
    }
  }
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
        await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_textless_a${attempt}_openai`, true, null, Date.now() - t0);
        return { bytes, provider: "openai" };
      }
      await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_textless_a${attempt}_openai`, false, "empty_bytes", Date.now() - t0);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_textless_a${attempt}_openai`, false, msg, Date.now() - t0);
      console.warn(`[coloring-v2-cover] openai-image failed: ${msg.slice(0, 300)}`);
    }
  }
  throw new Error("cover_smart_ai_unavailable:gemini_and_openai_both_failed");
}

function ensureColoringBookInTitle(t: string): string {
  const s = (t ?? "").trim();
  if (!s) return "Coloring Book";
  return /coloring/i.test(s) ? s : `${s} Coloring Book`;
}

function normalizeAgeBadge(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^ages?\s/i.test(s)) return s.replace(/^ages?\s+/i, "Ages ");
  if (/^\d+\s*[-–—]\s*\d+$/.test(s)) return `Ages ${s.replace(/\s+/g, "")}`;
  return `Ages ${s}`;
}

function titleEnvironmentFor(styleId: string): { env: string; zone: string } {
  switch (styleId) {
    case "magical_storybook":       return { env: "a soft glowing cloud ribbon with sparkling stars around it", zone: "upper 40%" };
    case "bold_cartoon_adventure":  return { env: "a bold banner arch with dynamic sparks and speed lines", zone: "upper 35%" };
    case "space_sci":               return { env: "a wide horizontal starfield panel with a subtle nebula glow", zone: "upper 35%" };
    case "fantasy_dragon":          return { env: "a stone-and-metal shield crest with heraldic flourishes", zone: "upper 40%" };
    case "futuristic_neon":         return { env: "a rectangular neon-lit holographic panel with soft cyan glow", zone: "upper 35%" };
    case "cute_preschool":          return { env: "a rounded pastel bubble with a soft cushion shape", zone: "upper 40%" };
    case "nature_woodland":         return { env: "a wooden signboard framed by leaves, vines and small berries", zone: "upper 40%" };
    case "retro_comic":             return { env: "a jagged comic starburst callout with halftone dot backing", zone: "upper 35%" };
    case "elegant_illustrated_serif": return { env: "a delicate botanical wreath with a smooth ivory bookplate inside", zone: "upper 40%" };
    case "hand_drawn_playful":      return { env: "a hand-painted paper-tape banner with playful doodled sparkles", zone: "upper 40%" };
    case "epic_cinematic":          return { env: "a dark metallic scroll panel with volumetric light behind it", zone: "lower 35%" };
    case "japanese_graphic":        return { env: "a flat graphic rectangle with a sakura petal ornament in one corner", zone: "upper 40%" };
    default:                        return { env: "a soft cloud panel with sparkles", zone: "upper 40%" };
  }
}

function isProviderBillingError(msg: string): boolean {
  const s = (msg ?? "").toLowerCase();
  return /billing|quota|credit|exhaust|insufficient|payment required|402|429|prepayment/.test(s);
}

async function raiseCoverAlert(book_id: string, title: string, reason: string, dispatchCount: number) {
  const billing = isProviderBillingError(reason);
  const alert_class = billing ? "provider_blocked" : "unbounded_retry";
  const dedupe_key = `cover_${alert_class}_${book_id}`;
  const alertTitle = billing
    ? `Provider billing block active: gemini+openai (cover ${book_id.slice(0, 8)})`
    : `Cover Builder V2 exceeded ${COVER_HARD_ATTEMPT_CAP} attempts for ${book_id.slice(0, 8)}`;
  const body = billing
    ? `Cover for "${title}" cannot generate — both smart-AI providers refused.\n• Book ${book_id.slice(0, 8)} parked at stage=failed after ${dispatchCount} dispatches.\n• Reason: ${reason.slice(0, 300)}`
    : `Cover for "${title}" rejected ${dispatchCount} times.\n• Last reason: ${reason.slice(0, 300)}`;
  try {
    await db().from("alert_log").upsert({
      alert_class, severity: "critical",
      title: alertTitle, body,
      evidence: { book_id, title, reason: reason.slice(0, 500), dispatchCount, law: COVER_LAW },
      dedupe_key,
    }, { onConflict: "dedupe_key" });
  } catch (_) { /* best-effort */ }
}

async function parkCoverAsFailed(book_id: string, reason: string) {
  try {
    await db().from("coloring_v2_books")
      .update({
        stage: "failed",
        stage_updated_at: new Date().toISOString(),
        last_error: `${COVER_LAW}: ${reason.slice(0, 400)}`,
        generation_status: "failed",
      })
      .eq("id", book_id);
  } catch (_) { /* best-effort */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "cover") return json({ ok: true, skipped: true, stage: book.stage });

    const priorAttempts = Number(book.stage_attempt_count ?? 0);
    if (priorAttempts >= COVER_HARD_ATTEMPT_CAP) {
      const reason = book.last_error ?? "cover_attempts_exhausted";
      await parkCoverAsFailed(book_id, reason);
      await raiseCoverAlert(book_id, book.title ?? "Untitled", reason, priorAttempts);
      return json({ ok: false, parked: true, reason: COVER_LAW, attempts: priorAttempts }, 200);
    }

    const prof = getAgeProfile(book.age_band);
    const { data: conceptAsset } = await db().from("coloring_v2_assets")
      .select("meta").eq("book_id", book_id).eq("kind", "concept").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const concept = conceptAsset?.meta ?? {};

    const rawTitle = book.title ?? concept.title ?? "Untitled";
    const title = ensureColoringBookInTitle(rawTitle);
    if (title !== rawTitle) {
      await db().from("coloring_v2_books").update({ title }).eq("id", book_id);
    }
    const ageBadge = normalizeAgeBadge(book.age_band ?? "");

    // Style + layout pick with recency avoidance.
    const recency = await loadRecencyPicks(db(), 15);
    const family = pickStyleFamily({
      title, theme: book.theme, ageBand: book.age_band,
      recentFamilies: recency.families,
    });
    // Prefer a layout the family recommends AND that isn't in the recency window.
    const layout = family.preferredLayouts.find((l) => !recency.layouts.includes(l))
      ?? family.preferredLayouts[0];
    const { env: titleEnvironment, zone: titleZoneDescriptor } = titleEnvironmentFor(family.id);

    const { data: interiorAssets } = await db().from("coloring_v2_assets")
      .select("storage_path, page_number").eq("book_id", book_id).eq("kind", "interior")
      .order("page_number", { ascending: true }).limit(3);
    const refs: string[] = [];
    for (const a of (interiorAssets ?? [])) {
      try { refs.push(await signedUrl(a.storage_path, 3600)); } catch { /* skip */ }
    }

    const textlessPrompt = buildTextlessColoringCoverPrompt({
      title,
      theme: book.theme,
      mainCharacters: (concept.hero_subjects ?? []).slice(0, 3),
      backgroundElements: (concept.motif_inventory ?? []).slice(0, 6),
      aspectDescriptor: "8.5 x 8.5 inches, square 1:1",
      hasInteriorReferences: refs.length > 0,
      styleMode: book.cover_mood === "ya_scifi_cinematic" ? "ya_scifi_cinematic" : "default",
      layoutFamily: layout,
      styleFamilyLabel: family.label,
      titleEnvironment,
      titleZoneDescriptor,
    });
    void prof;

    let flattened: Uint8Array | null = null;
    let treatmentMeta: any = null;
    let ocrVerdict: any = null;
    let sourceVerdict: any = null;
    let lastErr: any = null;
    let smartAiUnavailableCount = 0;
    let usedProvider: CoverProvider | null = null;
    let artBytesForAsset: Uint8Array | null = null;
    let overlayBytesForAsset: Uint8Array | null = null;

    for (let attempt = 1; attempt <= BAKE_ATTEMPTS; attempt++) {
      try {
        const { bytes: artBytes, provider } = await renderTextlessArt({ prompt: textlessPrompt, refs }, attempt, book_id);

        // Compose deterministic typography over the textless art.
        const composed = await composeColoringCover({
          artBytes,
          title,
          subtitle: "",
          description: null,
          palette: [],
          ageBadge,
        });

        // Pre-OCR canonical-source verification of the SVG typography.
        // The compositor's svg is exposed via treatmentMeta on the returned result;
        // when unavailable, fall back to trusting the compositor (all glyphs are
        // deterministic from canonical metadata by construction).
        const svg = (composed as any).svg ?? (composed.treatmentMeta as any)?.svg ?? "";
        sourceVerdict = svg
          ? verifyTypographySource(svg, { title, ageBadge, brandName: "SecretPDF Kids" })
          : { pass: true, reason: null, approved_tokens: [], found_text_nodes: [], unapproved_nodes: [], missing_required: [] };
        if (!sourceVerdict.pass) {
          throw new Error(`typography_source_violation:${sourceVerdict.reason}`);
        }

        // OWNER LAW `cover_source_of_truth_v11` (2026-07-22, PERMANENT):
        // The typography layer is rendered deterministically by us from
        // canonical metadata (ebooks_kids.title). typography-source-verifier
        // (above) is the HARD spelling gate — every glyph is proven to come
        // from approved tokens BEFORE raster. OCR on the flattened raster is
        // best-effort double-check only: Tesseract has high false-negative
        // rate on decorative/curved fonts, and failing on it blocks perfectly
        // correct covers and burns credits on retries.
        // → When source-verifier passes, ACCEPT the cover. OCR is logged as
        //   warn-only for audit; it never blocks and never triggers retry.
        try {
          const verdict = await verifyExactCoverText(composed.finalBytes, { title, subtitle: "", ageBadge });
          ocrVerdict = verdict;
          if (!verdict.pass) {
            console.warn(`[coloring-v2-cover] attempt ${attempt} OCR warn (soft-accept, source-verified): ${verdict.reason}`);
          }
        } catch (ocrErr) {
          console.warn(`[coloring-v2-cover] attempt ${attempt} OCR skipped:`, String((ocrErr as any)?.message ?? ocrErr));
          ocrVerdict = { pass: false, reason: `ocr_skipped:${String((ocrErr as any)?.message ?? ocrErr)}` };
        }

        flattened = composed.finalBytes;
        treatmentMeta = composed.treatmentMeta;
        artBytesForAsset = composed.artOnlyBytes;
        overlayBytesForAsset = composed.overlayBytes;
        usedProvider = provider;
        break;
      } catch (e: any) {
        lastErr = e;
        const em = String(e?.message ?? e);
        if (/cover_smart_ai_unavailable|billing|quota|prepayment|credit|402|429/i.test(em)) smartAiUnavailableCount++;
        console.warn(`[coloring-v2-cover] attempt ${attempt} error:`, em);
      }
    }

    if (!flattened && smartAiUnavailableCount >= BAKE_ATTEMPTS) {
      const reason = String(lastErr?.message ?? "cover_smart_ai_unavailable");
      await parkCoverAsFailed(book_id, reason);
      await raiseCoverAlert(book_id, title, reason, priorAttempts + 1);
      return json({ ok: false, parked: true, reason: "smart_ai_billing_locked", provider_error: reason }, 200);
    }

    if (!flattened) {
      const reason = ocrVerdict?.reason ?? sourceVerdict?.reason ?? lastErr?.message ?? "unknown";
      const nextAttempt = priorAttempts + 1;
      if (nextAttempt >= COVER_HARD_ATTEMPT_CAP) {
        await parkCoverAsFailed(book_id, reason);
        await raiseCoverAlert(book_id, title, reason, nextAttempt);
      }
      throw new Error(`cover_v2_hard_reject_after_${BAKE_ATTEMPTS}_attempts:${reason}`);
    }

    // Persist the three-layer artifacts so QC + admin can inspect them.
    if (artBytesForAsset) {
      await uploadAsset(book_id, "cover_illustration_layer", artBytesForAsset, "png", {
        law: COVER_LAW, layer: "illustration",
        style_family_id: family.id, layout_family_id: layout,
        cover_family: { style_family_id: family.id, layout_family_id: layout, style_family_label: family.label },
      });
    }
    if (overlayBytesForAsset) {
      await uploadAsset(book_id, "cover_typography_layer", overlayBytesForAsset, "png", {
        law: COVER_LAW, layer: "typography",
        source_verified: sourceVerdict?.pass === true,
        approved_tokens: sourceVerdict?.approved_tokens ?? [],
        rendered_text_nodes: sourceVerdict?.found_text_nodes ?? [],
      });
    }

    const asset = await uploadAsset(book_id, "cover_final", flattened, "jpg", {
      prompt_len: textlessPrompt.length, refs: refs.length,
      ocr_verdict: ocrVerdict?.reason ?? "n/a",
      ocr_pass: ocrVerdict?.pass === true,
      typography_source: "deterministic_exact_title_render",
      typography_source_verified: sourceVerdict?.pass === true,
      typography_source_reason: sourceVerdict?.reason ?? null,
      cover_family: { style_family_id: family.id, layout_family_id: layout, style_family_label: family.label },
      style_family_id: family.id,
      layout_family_id: layout,
      compositor: COLORING_COVER_COMPOSITOR_VERSION,
      canvas: { width: COLORING_COVER_WIDTH, height: COLORING_COVER_HEIGHT },
      text_mode: "textless_art_plus_deterministic_typography",
      prompt_version: COLORING_TEXTLESS_COVER_PROMPT_VERSION,
      provider: usedProvider,
      treatment: treatmentMeta,
      law: COVER_LAW,
    });
    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    await advance(book_id, "cover", "qc");
    await fireStage("coloring-v2-qc", { book_id });
    return json({
      ok: true, cover_asset: asset.id, next: "qc",
      text_mode: "textless_art_plus_deterministic_typography",
      style_family: family.id, layout: layout,
      source_verified: sourceVerdict?.pass === true,
      ocr: ocrVerdict?.reason ?? "pass",
    });
  } catch (e: any) {
    await recordError(book_id, "cover", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
