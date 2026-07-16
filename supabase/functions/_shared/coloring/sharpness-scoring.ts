// Pure math for sharpness scoring — no runtime deps so vitest can import.
// Kept in a separate module from the Deno-only decoder in sharpness-gate.ts
// so the calibrated threshold is import-safe from Node tests.

/**
 * Calibrated from measured Ocean Friends draft interiors at 512px
 * downsample.
 *
 * Full-book audit of all 30 ALREADY-ACCEPTED pages produced:
 *   min=13.55 (page 3, owner-flagged as slightly soft), p10=18.16,
 *   median=27.80, p90=46.27, max=48.04.
 *
 * Owner-flagged blurry SET p7/p23/p25/p35 measured at 4.0/4.2/5.5/3.8.
 * Failing repair regens (p19/p31 after portrait replan) measured 10.24/11.28.
 *
 * A floor of 15 rejected p3 (13.55) — an already-accepted page — which
 * makes the gate inconsistent with its own accepted set. Floor is
 * calibrated to 13.0 (just below the accepted-crisp minimum):
 *   - accepts every page of the accepted-crisp set (min 13.55)
 *   - still rejects the owner-flagged blurry set (max 5.5)
 *   - still rejects the failing repair regens (max 11.28)
 * Do not lower without owner sign-off + fresh calibration data.
 */
export const DEFAULT_SHARPNESS_MIN_SCORE = 13.0;

/**
 * Combine Sobel-magnitude mean and Laplacian variance into a monotonic
 * score on a 0..~30 scale. Tuned so Ocean Friends' crisp pages score ≥9
 * and its blurry pages score ≤6.
 */
export function combineScore(sobel_mean: number, laplacian_var: number): number {
  return sobel_mean / 4 + Math.sqrt(Math.max(0, laplacian_var)) / 10;
}
