// Pure math for sharpness scoring — no runtime deps so vitest can import.
// Kept in a separate module from the Deno-only decoder in sharpness-gate.ts
// so the calibrated threshold is import-safe from Node tests.

/**
 * Calibrated from measured Ocean Friends draft interiors at 512px
 * downsample (owner-flagged blurry pages: interiors 3, 19, 21, 31 →
 * scored 11.63, 11.17, 14.84, 10.86; adjacent crisp pages ≥ 15.62).
 * Floor at 15.0 catches the flagged set exactly. Do not lower without
 * owner sign-off + fresh calibration data.
 */
export const DEFAULT_SHARPNESS_MIN_SCORE = 15.0;

/**
 * Combine Sobel-magnitude mean and Laplacian variance into a monotonic
 * score on a 0..~30 scale. Tuned so Ocean Friends' crisp pages score ≥9
 * and its blurry pages score ≤6.
 */
export function combineScore(sobel_mean: number, laplacian_var: number): number {
  return sobel_mean / 4 + Math.sqrt(Math.max(0, laplacian_var)) / 10;
}
