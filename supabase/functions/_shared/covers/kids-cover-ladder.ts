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
import {
  geminiDirectImageWithMeta,
  gatewayImageWithRefs,
} from "../gemini-image.ts";
import { renderKidsTitleTreatment } from "./kids-title-treatment.ts";

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
}

export interface CoverLadderRungReport {
  rung: CoverRungLabel;
  attempted: boolean;
  produced_bytes: boolean;
  luminance: LuminanceStats | null;
  reason: string | null;   // dead reason, provider error, or 'ok'
  meta?: unknown;
}

export interface CoverLadderResult {
  bytes: Uint8Array;
  accepted_rung: CoverRungLabel;
  used_svg_fallback: boolean;
  title_treatment_metadata: Record<string, unknown> | null;
  rung_reports: CoverLadderRungReport[];
}

const DEFAULT_RUNGS: CoverRungLabel[] = [
  "ideogram_v3_a",
  "ideogram_v3_b",
  "recraft_v3_ref",
  "gemini_refs",
  "svg_synthetic_fallback",
];

function buildIdeogramPrompt(i: CoverLadderInput): string {
  if (i.ideogramCompositionOverride) return i.ideogramCompositionOverride;
  return [
    `Whimsical children's picture book COVER ARTWORK for a story titled "${i.title}".`,
    `Hero character: ${i.charDesc}. Show the hero warmly and clearly.`,
    `Portrait 1:1 composition, warm painterly lighting, cozy inviting mood, generous negative space in the upper third for a title overlay later.`,
    `Style: ${i.styleSuffix}.`,
    `ABSOLUTELY NO TEXT: no letters, no numbers, no title, no words, no signage, no watermark, no logo, no book mockup, no UI. Textless artwork only.`,
    `Avoid AI clichés: no purple/indigo gradients on white, no glossy 3D blobs, no stock face, no six-finger hands.`,
  ].join(" ");
}

function buildRefConditionedPrompt(i: CoverLadderInput): string {
  if (i.compositionOverride) return i.compositionOverride;
  return [
    `Whimsical children's picture book COVER ARTWORK for "${i.title}".`,
    `Hero character: ${i.charDesc}. Warmly-lit, richly detailed scene that captures the story's emotional promise.`,
    `Portrait composition, strong focal character, rich magical/nature environment when fitting, cozy inviting atmosphere, soft golden lighting, painterly textures, expressive character face, generous negative space at the top for a title to be added later.`,
    `Style: ${i.styleSuffix}. Hand-illustrated feel like a modern reference-grade picture book cover.`,
    i.description ? `Description hint: ${i.description}` : "",
    `ABSOLUTELY NO TEXT of any kind: no letters, no numbers, no title, no words, no logo, no watermark, no captions, no typography, no book mockup, no UI. Textless artwork only.`,
    `Avoid AI clichés: no purple/indigo gradients on white, no glossy 3D blobs, no stock face, no generic hero-on-gradient, no melted shapes, no six-finger hands.`,
  ].filter(Boolean).join(" ");
}

function buildGeminiPrompt(i: CoverLadderInput): string {
  if (i.geminiCompositionOverride) return i.geminiCompositionOverride;
  return [
    `Whimsical children's picture-book cover artwork.`,
    `Use the attached reference image(s) as the DEFINITIVE reference for the hero character's identity AND for the overall art style. Same hero, same style — no restyling, no different character.`,
    `Character notes: ${i.charDesc}.`,
    `Warm painterly lighting, cozy inviting mood, generous space in the upper third for a title overlay later. Portrait composition.`,
    `ABSOLUTE RULES: Do NOT draw any labels, signage, tag text, box text, onomatopoeia, speech bubbles, author lines, publisher marks, badges, watermarks, or writing of any kind. Completely text-free artwork.`,
  ].join(" ");
}

/**
 * Synthetic warm-cream canvas + subtle radial vignette. Deterministic,
 * uses only ImageScript — no external generator, cannot ever be dead.
 * Used as the guaranteed background for the SVG-fallback rung so a book
 * can NEVER retire for cover_dead.
 */
async function renderSyntheticCoverBackground(
  width = 1600,
  height = 1600,
  palette?: string[],
): Promise<Uint8Array> {
  const img = new Image(width, height);
  // Base warm cream
  const base = { r: 253, g: 240, b: 214 };
  // Accent from palette if provided
  const accentHex = (palette && palette.length ? palette[palette.length - 1] : "#E9B44C").replace("#", "");
  const ar = parseInt(accentHex.slice(0, 2), 16);
  const ag = parseInt(accentHex.slice(2, 4), 16);
  const ab = parseInt(accentHex.slice(4, 6), 16);
  const cx = width / 2;
  const cy = height * 0.6;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const t = Math.min(1, d * 1.1);
      const r = Math.round(base.r * (1 - t * 0.15) + ar * (t * 0.10));
      const g = Math.round(base.g * (1 - t * 0.15) + ag * (t * 0.10));
      const b = Math.round(base.b * (1 - t * 0.15) + ab * (t * 0.10));
      // ImageScript pixel encoding 0xRRGGBBAA
      const px = ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff;
      img.setPixelAt(x + 1, y + 1, px >>> 0);
    }
  }
  return await img.encode();
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
        try {
          const g = await geminiDirectImageWithMeta({
            prompt: buildGeminiPrompt(input),
            referenceUrls: refUrls,
            model: "google/gemini-3.1-flash-image",
            seed,
          });
          bytes = g.bytes;
          meta = g.meta;
        } catch (direct) {
          console.warn(`[cover-ladder] gemini-direct failed (${(direct as Error).message?.slice(0, 120)}) — gateway fallback`);
          bytes = await gatewayImageWithRefs({ prompt: buildGeminiPrompt(input), referenceUrls: refUrls });
          meta = { provider: "gateway_fallback" };
        }
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
  const bgBytes = await renderSyntheticCoverBackground(1600, 1600, input.palette);
  const treatment = await renderKidsTitleTreatment({
    coverBg: bgBytes,
    title: input.title,
    subtitle: input.subtitle ?? null,
    palette: input.palette,
    description: input.description ?? null,
  });
  reports.push({
    rung: "svg_synthetic_fallback",
    attempted: true,
    produced_bytes: true,
    luminance: null,
    reason: "svg_fallback_used",
    meta: { synthesized_background: true },
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
