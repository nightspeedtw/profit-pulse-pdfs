// Pure math for sharpness scoring — no runtime deps so vitest can import.
// Kept separate from the Deno-only decoder in sharpness-gate.ts.
//
// v5 root-cause fix (2026-07-16): the prior `visible_edge_score`
// (mean per-pixel neighbor luma delta over the whole raster) confounds
// SPARSITY with BLUR. Persisted evidence for Ocean Friends a05a5086 p3
// ("whale friendly portrait on plain white background" — sparse BY DESIGN
// after the simplify replan) shows laplacian_var 1521–2580 and sobel_mean
// 18–32 (crisp lines) while whole-image visible_edge_score fell to
// 1.78–2.89 and failed the 6.5 floor. The simplify/portrait-replan ladder
// intentionally makes pages sparser, so every replan drove the metric
// LOWER forever. That behaviour would also hard-block the incoming
// Toddler (2–3) and Senior (60+) age-band contracts, both of which mandate
// sparse pages.
//
// The new gate measures LINE-EDGE TRANSITION QUALITY, not global density:
// only ink pixels (luma<128) whose 3×3 neighbourhood touches paper
// (luma≥PAPER_LUMA) contribute; the score is the mean ink→paper luma
// delta on those boundary pixels. Crisp thick lines score ≈180–255
// (white→black within 1–2 px). Blurry mushy lines score ≈40–100 (a 5–8 px
// ramp caps the reachable delta).
//
// Result: a sparse page with crisp boundaries PASSES; a dense page with
// mushy boundaries FAILS. Whole-image density (the historical
// `visible_edge_score`) is still recorded for telemetry, but is no longer
// a gate — this is a metric correction, NOT a threshold reduction.

/**
 * Historical Sobel+Laplacian combined score floor. Retained only so legacy
 * telemetry rows and trend consumers keep a stable reference value. It is no
 * longer pass/fail authority.
 */
export const DEFAULT_SHARPNESS_MIN_SCORE = 13.0;

/**
 * @deprecated Replaced by DEFAULT_BOUNDARY_EDGE_MIN_SCORE. Kept exported
 * so legacy persisted rows and telemetry consumers keep resolving; the
 * gate no longer reads it.
 */
export const DEFAULT_VISIBLE_EDGE_MIN_SCORE = 6.5;

/**
 * Ink pixel: raster luma below this is treated as line ink.
 */
export const INK_LUMA = 128;

/**
 * Paper pixel: raster luma at or above this is treated as bright page
 * background — required to be adjacent to an ink pixel for it to count
 * as a boundary.
 */
export const PAPER_LUMA = 170;

/**
 * A raster with fewer ink pixels than this is treated as effectively
 * blank — the blur gate cannot judge line quality on it and defers to
 * the black-density gate.
 */
export const MIN_INK_PIXELS = 24;

/**
 * Below this count of ink→paper transition pixels the gate treats the
 * raster as having NO CRISP BOUNDARY. If ink IS present (>=MIN_INK_PIXELS)
 * this is a hard fail (mushy line art). If no ink is present it's a
 * deferral to the blackness gate. See passesBoundaryEdgeGate below.
 */
export const MIN_BOUNDARY_PIXELS = 24;

/**
 * Calibration boundary from the fixture sets (crisp-busy accepted set,
 * crisp-sparse toddler-style single-subject page, and the owner-flagged
 * blurry originals p7/p23/p25/p35). Crisp boundaries measure ≥160 mean
 * ink→paper contrast; blurry lines cap out well below 120.
 *
 * Do not lower without a fresh three-fixture calibration signed off by
 * the owner.
 */
export const DEFAULT_BOUNDARY_EDGE_MIN_SCORE = 140;

export const SHARPNESS_GATE_VERSION = "v6:boundary-edge-authority-min140";

/**
 * Combine Sobel-magnitude mean and Laplacian variance into a monotonic
 * score on a 0..~30 scale. Same combiner as v3/v4 for telemetry continuity.
 */
export function combineScore(sobel_mean: number, laplacian_var: number): number {
  return sobel_mean / 4 + Math.sqrt(Math.max(0, laplacian_var)) / 10;
}

/**
 * Sparsity-invariant blur measurement. For every ink pixel (luma<INK_LUMA)
 * with at least one paper neighbour (luma≥PAPER_LUMA) in its 3×3
 * neighbourhood, record the maximum neighbour-vs-centre luma delta. The
 * returned score is the mean of those deltas.
 *
 * Crisp thick lines: delta≈180–255 across a 1–2 px transition → score high.
 * Blurry mushy lines: transition ramps over 5–8 px so the max reachable
 *   ink↔paper delta between adjacent pixels shrinks → score low, and
 *   frequently NO ink pixel even touches a paper pixel → boundary_pixels
 *   collapses to zero while ink_pixels stays large. Both signals fail
 *   the gate; see passesBoundaryEdgeGate.
 * Sparse crisp page (large white area, small crisp subject): still measures
 *   only the subject's boundary pixels → score high (PASSES).
 */
export function boundaryEdgeStrength(
  luma: Float32Array | number[],
  w: number,
  h: number,
): { score: number; boundary_pixels: number; ink_pixels: number } {
  if (!w || !h) return { score: 0, boundary_pixels: 0, ink_pixels: 0 };
  let sum = 0;
  let boundary = 0;
  let ink = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const c = luma[i];
      if (c >= INK_LUMA) continue;
      ink++;
      let best = 0;
      let touchedPaper = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = luma[i + dy * w + dx];
          if (n >= PAPER_LUMA) {
            touchedPaper = true;
            const d = n - c;
            if (d > best) best = d;
          }
        }
      }
      if (touchedPaper) {
        sum += best;
        boundary++;
      }
    }
  }
  return { score: boundary ? sum / boundary : 0, boundary_pixels: boundary, ink_pixels: ink };
}

/**
 * Gate helper.
 *   • No ink at all (ink_pixels < MIN_INK_PIXELS): raster is effectively
 *     blank — defer to the black-density gate (return true).
 *   • Ink present but no crisp ink→paper transition
 *     (boundary_pixels < MIN_BOUNDARY_PIXELS): mushy line art — FAIL.
 *   • Otherwise: fail iff mean boundary delta < min.
 */
export function passesBoundaryEdgeGate(
  boundary_pixels: number,
  score: number,
  min: number = DEFAULT_BOUNDARY_EDGE_MIN_SCORE,
  ink_pixels: number = boundary_pixels, // legacy 2-arg callers: assume ink==boundary
): boolean {
  if (ink_pixels < MIN_INK_PIXELS) return true;
  if (boundary_pixels < MIN_BOUNDARY_PIXELS) return false;
  return score >= min;
}

export interface SharpnessGateInputs {
  legacy_score: number;
  legacy_min?: number;
  boundary_pixels: number;
  boundary_score: number;
  boundary_min?: number;
  ink_pixels?: number;
}

/**
 * Final sharpness authority for v5. The legacy Sobel/Laplacian score is
 * accepted as an input only to make its non-authoritative status explicit:
 * it is telemetry and cannot veto a boundary-edge pass.
 */
export function passesSharpnessGate(input: SharpnessGateInputs): boolean {
  void input.legacy_score;
  void input.legacy_min;
  return passesBoundaryEdgeGate(
    input.boundary_pixels,
    input.boundary_score,
    input.boundary_min ?? DEFAULT_BOUNDARY_EDGE_MIN_SCORE,
    input.ink_pixels ?? input.boundary_pixels,
  );
}

/**
 * @deprecated v4 whole-image visible-edge gate. Preserved only so the
 * name still resolves for the historical import — the gate never fails
 * on this score anymore. Use passesBoundaryEdgeGate instead.
 */
export function passesVisibleBlurBoundary(_visible_edge_score: number, _min = DEFAULT_VISIBLE_EDGE_MIN_SCORE): boolean {
  return true;
}
