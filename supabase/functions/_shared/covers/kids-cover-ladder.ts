// Unified kids cover ladder — used by EVERY cover-producing path
// (initial autopilot cover + interior-based repair cover).
//
// Rules the ladder enforces:
//   • Dead frames NEVER consume concept/retire budget. A dead cover from
//     one rung silently advances to the next rung. Only full ladder
//     exhaustion counts as a real failure — and even then, the SVG
//     synthetic-background fallback below CANNOT return a dead frame,
//     so a book can never retire for "cover_dead" while this ladder is used.
//   • Every rung is a distinct provider or seed, not blind retries of one.
//   • Rungs are ordered by cost-effectiveness + character-fidelity.
//   • Final rung is a deterministic synthetic warm-cream canvas + SVG
//     title-treatment overlay. It uses no external generator and cannot
//     produce a near-black / dead image.
//
// Callers pass their prompt + character reference urls + labels. Interior
// callers pass interior_refs; initial callers pass just the character-ref
// sheet (single ref is fine).

// @ts-nocheck  Deno edge runtime
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { computeLuminance, type LuminanceStats } from "../image-luminance.ts";
import { falIdeogramV3, falRecraftV3 } from "../fal.ts";
import { geminiDirectImageWithMeta } from "../gemini-direct.ts";
import { renderKidsTitleTreatment } from "./kids-title-treatment.ts";
import {
  transcribeGlyphs,
  verifyCategoryHero,
  type GlyphVerdict,
  type HeroVerdict,
} from "./cover-vision-guards.ts";

export const TEXTLESS_DIRECTIVE = [
  "TEXTLESS BACKGROUND ART ONLY.",
  "Do not draw the book title, subtitle, age badge, author line, publisher mark, letters, numbers, signage, captions, speech bubbles, watermarks, or logos.",
  "Leave all typography to the deterministic SVG overlay after generation.",
].join(" ");

export type CoverRungLabel =
  | "ideogram_v3_a"
  | "ideogram_v3_b"
  | "recraft_v3_ref"
  | "gemini_refs"
  | "svg_synthetic_fallback";

export interface CoverLadderInput {
  ebookId: string;
  title: string;
  subtitle: string | null;
  ageBadge?: string | null;
  description?: string | null;
  palette?: string[];
  charDesc: string;                // e.g. "named Pip (fox), rust hair..."
  heroName?: string | null;
  styleSuffix: string;
  negativePrompt: string;
  refUrls: string[];               // 1..N — character reference sheet(s) / interior refs
  // Optional prompt overrides for interior-repair callers that want a specific composition
  compositionOverride?: string;
  ideogramCompositionOverride?: string;
  geminiCompositionOverride?: string;
  // Which rungs to run, in order. Defaults to full ladder.
  rungs?: CoverRungLabel[];
  // Vision-gate config (Defect Class 1 permanent fixes).
  categoryName?: string;
  allowedSubjects?: string[];
  forbiddenSubjects?: string[];
  // Feature flag for callers that want to skip vision gates (tests, unit runs).
  skipVisionGuards?: boolean;
  // Per-invocation Ideogram rendering-speed override. Class 2 fix: the
  // cover state machine tries QUALITY → BALANCED → TURBO on the ideogram
  // rungs before falling to the next rung, so wall-clock timeouts on
  // slow QUALITY calls do not silently loop.
  ideogramRenderingSpeed?: "TURBO" | "BALANCED" | "QUALITY";
}

export interface CoverLadderRungReport {
  rung: CoverRungLabel;
  attempted: boolean;
  produced_bytes: boolean;
  luminance: LuminanceStats | null;
  reason: string | null;   // dead reason, provider error, or 'ok'
  meta?: unknown;
  glyph_verdict?: GlyphVerdict | null;
  hero_verdict?: HeroVerdict | null;
}

export interface CoverLadderResult {
  bytes: Uint8Array;
  accepted_rung: CoverRungLabel;
  used_svg_fallback: boolean;
  title_treatment_metadata: Record<string, unknown> | null;
  rung_reports: CoverLadderRungReport[];
}

export const DEFAULT_COVER_RUNGS: CoverRungLabel[] = [
  "ideogram_v3_a",
  "ideogram_v3_b",
  "recraft_v3_ref",
  "gemini_refs",
  "svg_synthetic_fallback",
];

const DEFAULT_RUNGS = DEFAULT_COVER_RUNGS;

export interface SingleRungResult {
  // "dead-equivalent" == "dead" but rejected by a vision guard (baked text
  // or wrong subject) rather than luminance. Callers treat it identically:
  // silent advance, does NOT consume retire budget.
  status: "ok" | "dead" | "dead-equivalent" | "error" | "fallback";
  bytes: Uint8Array | null;
  report: CoverLadderRungReport;
  title_treatment_metadata?: Record<string, unknown> | null;
  used_svg_fallback?: boolean;
}

/**
 * Run EXACTLY ONE cover-ladder rung. Extracted so callers can spread rung
 * execution across multiple edge-function invocations (per-rung state
 * machine) without hitting per-invocation CPU limits.
 *
 * For the SVG synthetic fallback rung, bytes are the final composited
 * cover (background + title treatment). For all other rungs, callers must
 * still composite the title treatment on top of the returned bytes.
 */
export async function runSingleCoverRung(
  input: CoverLadderInput,
  rung: CoverRungLabel,
): Promise<SingleRungResult> {
  const refUrls = input.refUrls.filter(Boolean);
  const report: CoverLadderRungReport = {
    rung,
    attempted: true,
    produced_bytes: false,
    luminance: null,
    reason: null,
  };

  if (rung === "svg_synthetic_fallback") {
    const bg = await renderFallbackCoverBackground(input);
    const treatment = await renderKidsTitleTreatment({
      coverBg: bg.bytes,
      title: input.title,
      subtitle: input.subtitle ?? null,
      palette: input.palette,
      description: input.description ?? null,
        ageBadge: input.ageBadge ?? null,
    });
    report.produced_bytes = true;
    report.reason = "svg_fallback_used";
      report.meta = { synthesized_background: bg.synthesized_background, used_reference_background: bg.used_reference_background };
    return {
      status: "fallback",
      bytes: treatment.png,
      report,
      title_treatment_metadata: treatment.metadata as unknown as Record<string, unknown>,
      used_svg_fallback: true,
    };
  }

  try {
    let bytes: Uint8Array | null = null;
    let meta: unknown = null;
    const seed = 1000 + Math.abs(hashSeed(input.ebookId + rung));

    if (rung === "ideogram_v3_a" || rung === "ideogram_v3_b") {
      const jitter = rung === "ideogram_v3_b"
        ? " Slight variation: warmer lighting, higher pose energy, fresh camera angle."
        : "";
      bytes = await falIdeogramV3({
        prompt: buildIdeogramPrompt(input) + jitter,
        image_size: "square_hd",
        style: "DESIGN",
        rendering_speed: input.ideogramRenderingSpeed ?? "QUALITY",
        seed,
        negative_prompt: `${input.negativePrompt}, text, letters, numbers, words, title, typography, watermark, logo, book mockup, ui, caption, subtitle, spine, black canvas, near-black image, empty image, blank image`,
        ebook_id: input.ebookId,
        step: `kids_cover_${rung}_${input.ideogramRenderingSpeed ?? "QUALITY"}`,
      });
    } else if (rung === "recraft_v3_ref") {
      bytes = await falRecraftV3({
        prompt: buildRefConditionedPrompt(input),
        image_url: refUrls[0],
        strength: 0.6,
        image_size: "portrait_4_3",
        negative_prompt: `${input.negativePrompt}, black canvas, near-black image, empty image, blank image, text, letters, numbers, words, title, typography, watermark, logo, book mockup, ui, caption, subtitle, spine, gradient on white, glossy 3d blob, stock photo, six fingers, deformed hands, generic ai look`,
        ebook_id: input.ebookId,
        step: `kids_cover_${rung}`,
      });
      meta = { provider: "fal", model: "recraft-v3" };
    } else if (rung === "gemini_refs") {
      const g = await geminiDirectImageWithMeta({
        prompt: buildGeminiPrompt(input),
        referenceUrls: refUrls,
        model: "google/gemini-3.1-flash-image",
        seed,
      });
      bytes = g.bytes;
      meta = g.meta;
    }

    if (!bytes || bytes.length < 1024) {
      report.reason = "no_bytes";
      return { status: "error", bytes: null, report };
    }
    report.produced_bytes = true;
    const lum = await computeLuminance(bytes);
    report.luminance = lum;
    report.meta = meta;
    if (lum.dead) {
      report.reason = `dead:${lum.reason}(mean=${lum.mean.toFixed(1)},var=${lum.variance.toFixed(0)})`;
      return { status: "dead", bytes: null, report };
    }

    // ── Vision guards (Defect Class 1: no baked text, correct hero subject) ──
    if (!input.skipVisionGuards) {
      try {
        const glyph = await transcribeGlyphs(bytes);
        report.glyph_verdict = glyph;
        if (glyph.has_glyphs && !glyph.degraded) {
          report.reason = `dead-equivalent:baked_text:${(glyph.detected_text ?? "").slice(0, 80)}`;
          console.warn(`[cover-ladder] rung=${rung} BAKED_TEXT — advancing (${report.reason})`);
          return { status: "dead-equivalent", bytes: null, report };
        }
      } catch (e) {
        console.warn(`[cover-ladder] glyph guard error rung=${rung}: ${(e as Error).message}`);
      }
      if ((input.allowedSubjects?.length ?? 0) > 0) {
        try {
          const hero = await verifyCategoryHero(bytes, {
            category_name: input.categoryName ?? "children's book",
            allowed_subjects: input.allowedSubjects ?? [],
            forbidden_subjects: input.forbiddenSubjects ?? [],
          });
          report.hero_verdict = hero;
          if (!hero.matches && !hero.degraded) {
            report.reason = `dead-equivalent:${hero.reason}`;
            console.warn(`[cover-ladder] rung=${rung} WRONG_SUBJECT — advancing (${report.reason})`);
            return { status: "dead-equivalent", bytes: null, report };
          }
        } catch (e) {
          console.warn(`[cover-ladder] hero guard error rung=${rung}: ${(e as Error).message}`);
        }
      }
    }

    report.reason = "ok";
    return { status: "ok", bytes, report };
  } catch (e) {
    report.reason = `gen_error:${String((e as Error).message ?? e).slice(0, 220)}`;
    return { status: "error", bytes: null, report };
  }
}

function buildIdeogramPrompt(i: CoverLadderInput): string {
  if (i.ideogramCompositionOverride) return `${i.ideogramCompositionOverride} ${TEXTLESS_DIRECTIVE}`;
  return [
    `Whimsical children's coloring-book COVER BACKGROUND ARTWORK.`,
    `Hero character: ${i.charDesc}. Show the hero warmly and clearly.`,
    `Portrait 1:1 composition, warm painterly lighting, cozy inviting mood, generous negative space in the upper third for a title overlay later.`,
    `Style: ${i.styleSuffix}.`,
    TEXTLESS_DIRECTIVE,
    `Avoid AI clichés: no purple/indigo gradients on white, no glossy 3D blobs, no stock face, no six-finger hands.`,
  ].join(" ");
}

function buildRefConditionedPrompt(i: CoverLadderInput): string {
  if (i.compositionOverride) return `${i.compositionOverride} ${TEXTLESS_DIRECTIVE}`;
  return [
    `Whimsical children's coloring-book COVER BACKGROUND ARTWORK.`,
    `Hero character: ${i.charDesc}. Warmly-lit, richly detailed scene that captures the story's emotional promise.`,
    `Portrait composition, strong focal character, rich magical/nature environment when fitting, cozy inviting atmosphere, soft golden lighting, painterly textures, expressive character face, generous negative space at the top for a title to be added later.`,
    `Style: ${i.styleSuffix}. Hand-illustrated feel like a modern reference-grade picture book cover.`,
    i.description ? `Description hint: ${i.description}` : "",
    TEXTLESS_DIRECTIVE,
    `Avoid AI clichés: no purple/indigo gradients on white, no glossy 3D blobs, no stock face, no generic hero-on-gradient, no melted shapes, no six-finger hands.`,
  ].filter(Boolean).join(" ");
}

function buildGeminiPrompt(i: CoverLadderInput): string {
  if (i.geminiCompositionOverride) return `${i.geminiCompositionOverride} ${TEXTLESS_DIRECTIVE}`;
  return [
    `Whimsical children's picture-book cover artwork.`,
    `Use the attached reference image(s) as the DEFINITIVE reference for the hero character's identity AND for the overall art style. Same hero, same style — no restyling, no different character.`,
    `Character notes: ${i.charDesc}.`,
    `Warm painterly lighting, cozy inviting mood, generous space in the upper third for a title overlay later. Portrait composition.`,
    TEXTLESS_DIRECTIVE,
  ].join(" ");
}

/**
 * OWNER LAW 'cover_can_never_fail' — the blank/gradient synthetic cover
 * background is PERMANENTLY DELETED. If every AI rung fails and no real
 * reference image is available, the ladder throws — the caller must route
 * through the deterministic self-art rung (see `_shared/coloring/self-art-cover.ts`
 * for the coloring lane) instead of shipping a blank canvas.
 *
 * A reference image (interior page or character sheet) is still accepted
 * as an emergency background because it IS real, gate-passed art — not a
 * gradient. Only the "make something up out of RGB" path is removed.
 */
async function renderFallbackCoverBackground(input: CoverLadderInput): Promise<{ bytes: Uint8Array; synthesized_background: boolean; used_reference_background: boolean }> {
  const ref = input.refUrls.filter(Boolean)[0];
  if (ref) {
    try {
      const r = await fetch(ref);
      if (r.ok) return { bytes: new Uint8Array(await r.arrayBuffer()), synthesized_background: false, used_reference_background: true };
    } catch (e) {
      console.warn(`[cover-ladder] fallback reference fetch failed: ${(e as Error).message}`);
    }
  }
  throw new Error("cover_can_never_fail:no_reference_background_available:blank_gradient_synth_removed");
}

/**
 * Run the unified cover ladder. Returns the accepted cover bytes + which
 * rung produced them. Dead frames from any rung are silently skipped;
 * only ladder exhaustion or a hard generator error on the SVG rung fails.
 */
export async function renderKidsCoverWithLadder(
  input: CoverLadderInput,
): Promise<CoverLadderResult> {
  const rungs = input.rungs ?? DEFAULT_RUNGS;
  const reports: CoverLadderRungReport[] = [];
  const refUrls = input.refUrls.filter(Boolean);

  for (const rung of rungs) {
    if (rung === "svg_synthetic_fallback") break; // handled below unconditionally
    const report: CoverLadderRungReport = {
      rung,
      attempted: true,
      produced_bytes: false,
      luminance: null,
      reason: null,
    };
    try {
      let bytes: Uint8Array | null = null;
      let meta: unknown = null;
      const seed = 1000 + Math.abs(hashSeed(input.ebookId + rung));

      if (rung === "ideogram_v3_a" || rung === "ideogram_v3_b") {
        const jitter = rung === "ideogram_v3_b"
          ? " Slight variation: warmer lighting, higher pose energy, fresh camera angle."
          : "";
        bytes = await falIdeogramV3({
          prompt: buildIdeogramPrompt(input) + jitter,
          image_size: "square_hd",
          style: "DESIGN",
          rendering_speed: "QUALITY",
          seed,
          negative_prompt: `${input.negativePrompt}, text, letters, numbers, words, title, typography, watermark, logo, book mockup, ui, caption, subtitle, spine, black canvas, near-black image, empty image, blank image`,
          ebook_id: input.ebookId,
          step: `kids_cover_${rung}`,
        });
      } else if (rung === "recraft_v3_ref") {
        bytes = await falRecraftV3({
          prompt: buildRefConditionedPrompt(input),
          image_url: refUrls[0],
          strength: 0.6,
          image_size: "portrait_4_3",
          negative_prompt: `${input.negativePrompt}, black canvas, near-black image, empty image, blank image, text, letters, numbers, words, title, typography, watermark, logo, book mockup, ui, caption, subtitle, spine, gradient on white, glossy 3d blob, stock photo, six fingers, deformed hands, generic ai look`,
          ebook_id: input.ebookId,
          step: `kids_cover_${rung}`,
        });
        meta = { provider: "fal", model: "recraft-v3" };
      } else if (rung === "gemini_refs") {
        const g = await geminiDirectImageWithMeta({
          prompt: buildGeminiPrompt(input),
          referenceUrls: refUrls,
          model: "google/gemini-3.1-flash-image",
          seed,
        });
        bytes = g.bytes;
        meta = g.meta;
      }

      if (!bytes || bytes.length < 1024) {
        report.reason = "no_bytes";
        reports.push(report);
        continue;
      }
      report.produced_bytes = true;
      const lum = await computeLuminance(bytes);
      report.luminance = lum;
      report.meta = meta;
      if (lum.dead) {
        report.reason = `dead:${lum.reason}(mean=${lum.mean.toFixed(1)},var=${lum.variance.toFixed(0)})`;
        console.warn(`[cover-ladder] rung=${rung} DEAD ${report.reason} — advancing`);
        reports.push(report);
        continue;
      }
      report.reason = "ok";
      reports.push(report);
      return {
        bytes,
        accepted_rung: rung,
        used_svg_fallback: false,
        title_treatment_metadata: null,
        rung_reports: reports,
      };
    } catch (e) {
      report.reason = `gen_error:${String((e as Error).message ?? e).slice(0, 220)}`;
      console.warn(`[cover-ladder] rung=${rung} error ${report.reason} — advancing`);
      reports.push(report);
      continue;
    }
  }

  // ── GUARANTEED SVG-OVERLAY FALLBACK ──
  // Synthesizes a warm-cream background locally (dead-impossible) and
  // composites the SVG title treatment on top. A book cannot retire for
  // cover_dead while this rung exists.
  const bg = await renderFallbackCoverBackground(input);
  const treatment = await renderKidsTitleTreatment({
    coverBg: bg.bytes,
    title: input.title,
    subtitle: input.subtitle ?? null,
    palette: input.palette,
    description: input.description ?? null,
    ageBadge: input.ageBadge ?? null,
  });
  reports.push({
    rung: "svg_synthetic_fallback",
    attempted: true,
    produced_bytes: true,
    luminance: null,
    reason: "svg_fallback_used",
    meta: { synthesized_background: bg.synthesized_background, used_reference_background: bg.used_reference_background },
  });
  return {
    bytes: treatment.png,
    accepted_rung: "svg_synthetic_fallback",
    used_svg_fallback: true,
    title_treatment_metadata: treatment.metadata as unknown as Record<string, unknown>,
    rung_reports: reports,
  };
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
