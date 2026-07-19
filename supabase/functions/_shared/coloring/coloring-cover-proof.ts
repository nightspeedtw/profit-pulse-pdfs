// Pure rendered-proof contract for final coloring covers.
// No Deno, no WASM, no provider dependencies — vitest imports this directly.

export interface ProofFrameElement {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProofFrame {
  width: number;
  height: number;
  safe_margin: number;
  elements: ProofFrameElement[];
}

export interface RenderedCoverProofInput {
  rgba: Uint8Array;
  width: number;
  height: number;
  frame: ProofFrame;
  /**
   * Legacy flat list. When provided WITHOUT `requiredStrings`, treated as
   * "all required" (back-compat). Prefer passing required/optional split.
   */
  approvedStrings?: string[];
  /** Must-render strings (typically just the title). Missing → hard fail. */
  requiredStrings?: string[];
  /** Nice-to-have strings (subtitle, age badge). Missing → warning only. */
  optionalStrings?: string[];
  detectedText: string;
  /** Optional override for expected aspect ratio (default = 8.5/11 portrait). Use 1.0 for square_8_5 books. */
  expectedAspect?: number;
}

export interface RenderedCoverProof {
  pass: boolean;
  reasons: string[];
  width: number;
  height: number;
  aspect_ratio: number;
  expected_aspect_ratio: number;
  portrait_aspect_pass: boolean;
  art_region: {
    sample_count: number;
    avg_chroma: number;
    luminance_stdev: number;
    unique_color_buckets: number;
    pass: boolean;
  };
  overlays_in_frame: {
    pass: boolean;
    clipped: string[];
  };
  transcription: {
    pass: boolean;
    missing: string[];
    missing_required: string[];
    missing_optional: string[];
    extra_unapproved: string[];
    detected_text: string;
  };
}

export const COLORING_COVER_WIDTH = 1600;
export const COLORING_COVER_HEIGHT = 2071; // 8.5x11 portrait at 1600px wide
export const COLORING_COVER_COMPOSITOR_VERSION = "coloring_cover_compositor_v2_art_plus_transparent_overlay_portrait";
const LETTER_ASPECT = 8.5 / 11;

function norm(s: string): string {
  return String(s ?? "")
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function assertProofOverlayInsideSafeMargin(frame: ProofFrame): { pass: boolean; clipped: string[] } {
  const clipped: string[] = [];
  const min = frame.safe_margin;
  const maxX = frame.width - frame.safe_margin;
  const maxY = frame.height - frame.safe_margin;
  for (const el of frame.elements ?? []) {
    if (el.x < min || el.y < min || el.x + el.w > maxX || el.y + el.h > maxY) clipped.push(el.name);
  }
  return { pass: clipped.length === 0, clipped };
}

/**
 * Consolidated cover-text transcription contract shared with
 * `cover-text-transcription.verifyExactCoverText`. Required strings
 * (title) MUST appear; optional strings (subtitle, age badge) trigger
 * a warning only. Extra unapproved text remains a HARD FAIL — owner law
 * `cover_random_embedded_text = 0`.
 */
export function verifyApprovedTranscription(
  required: string[],
  optional: string[],
  detectedText: string,
) {
  const detected = norm(detectedText);
  const req = required.map(norm).filter(Boolean);
  const opt = optional.map(norm).filter(Boolean);
  const missing_required = req.filter((s) => !detected.includes(s));
  const missing_optional = opt.filter((s) => !detected.includes(s));
  const missing = [...missing_required, ...missing_optional];
  // Strip every approved string (required OR optional) that IS present from
  // the detected text; whatever remains is unapproved extra text. Owner law:
  // any unapproved baked text is a hard fail (same class as gibberish /
  // watermark / duplicate "COLORING BOOK" banners).
  let residual = detected;
  for (const s of [...req, ...opt]) {
    if (!s) continue;
    residual = residual.split(s).join(" ");
  }
  residual = residual.replace(/\s+/g, " ").trim();
  const extra_unapproved = residual ? [residual] : [];
  const pass = missing_required.length === 0 && extra_unapproved.length === 0;
  return {
    pass,
    missing,
    missing_required,
    missing_optional,
    extra_unapproved,
    detected_text: detectedText,
  };
}

export function measureFinalArtRegionVariance(rgba: Uint8Array, width: number, height: number) {
  // Art proof samples the middle/bottom 60% of the FINAL raster, where the
  // historical bad covers were empty gradient. It intentionally ignores the
  // title-heavy top area so typography cannot fake art variance.
  const y0 = Math.floor(height * 0.38);
  const y1 = Math.floor(height * 0.94);
  const x0 = Math.floor(width * 0.08);
  const x1 = Math.floor(width * 0.92);
  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 100));
  let n = 0;
  let chromaSum = 0;
  let lumSum = 0;
  let lumSq = 0;
  const buckets = new Set<string>();
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * width + x) * 4;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      chromaSum += chroma;
      lumSum += lum;
      lumSq += lum * lum;
      buckets.add(`${r >> 4}-${g >> 4}-${b >> 4}`);
      n += 1;
    }
  }
  const avg_chroma = n ? chromaSum / n : 0;
  const mean = n ? lumSum / n : 0;
  const variance = n ? Math.max(0, lumSq / n - mean * mean) : 0;
  const luminance_stdev = Math.sqrt(variance);
  const unique_color_buckets = buckets.size;
  return {
    sample_count: n,
    avg_chroma: Number(avg_chroma.toFixed(2)),
    luminance_stdev: Number(luminance_stdev.toFixed(2)),
    unique_color_buckets,
    pass: n > 0 && avg_chroma >= 18 && luminance_stdev >= 18 && unique_color_buckets >= 18,
  };
}

export function renderedColoringCoverProof(input: RenderedCoverProofInput): RenderedCoverProof {
  const aspect = input.width / Math.max(1, input.height);
  const expectedAspect = typeof input.expectedAspect === "number" && input.expectedAspect > 0 ? input.expectedAspect : LETTER_ASPECT;
  const portrait_aspect_pass = Math.abs(aspect - expectedAspect) <= 0.012;
  const art_region = measureFinalArtRegionVariance(input.rgba, input.width, input.height);
  const overlays_in_frame = assertProofOverlayInsideSafeMargin(input.frame);
  // Back-compat: if only legacy flat `approvedStrings` was supplied, treat
  // ALL entries as required (old callers expected any missing string to fail).
  // New callers pass explicit required/optional split.
  const required = input.requiredStrings ?? input.approvedStrings ?? [];
  const optional = input.optionalStrings ?? [];
  const transcription = verifyApprovedTranscription(required, optional, input.detectedText);
  const reasons: string[] = [];
  if (!portrait_aspect_pass) reasons.push(`not_letter_portrait:${input.width}x${input.height}`);
  if (!art_region.pass) reasons.push(`final_art_region_low_variance:chroma=${art_region.avg_chroma}:stdev=${art_region.luminance_stdev}:buckets=${art_region.unique_color_buckets}`);
  if (!overlays_in_frame.pass) reasons.push(`overlay_clipped:${overlays_in_frame.clipped.join(",")}`);
  if (!transcription.pass) reasons.push(`transcription_mismatch:missing_required=${transcription.missing_required.join("|")}:extra=${transcription.extra_unapproved.join("|")}`);
  return {
    pass: reasons.length === 0,
    reasons,
    width: input.width,
    height: input.height,
    aspect_ratio: Number(aspect.toFixed(4)),
    expected_aspect_ratio: Number(LETTER_ASPECT.toFixed(4)),
    portrait_aspect_pass,
    art_region,
    overlays_in_frame,
    transcription,
  };
}