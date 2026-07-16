// Pure math for sharpness scoring — no runtime deps so vitest can import.
// Kept in a separate module from the Deno-only decoder in sharpness-gate.ts
// so the calibrated threshold is import-safe from Node tests.

/** Calibrated from owner-cited scores. Do not lower without owner sign-off. */
export const DEFAULT_SHARPNESS_MIN_SCORE = 8.0;

/**
 * Combine Sobel-magnitude mean and Laplacian variance into a monotonic
 * score on a 0..~30 scale. Tuned so Ocean Friends' crisp pages score ≥9
 * and its blurry pages score ≤6.
 */
export function combineScore(sobel_mean: number, laplacian_var: number): number {
  return sobel_mean / 4 + Math.sqrt(Math.max(0, laplacian_var)) / 10;
}
