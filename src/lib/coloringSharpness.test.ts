// Regression tests for Defect Class 2 (interior sharpness gate) and
// generation-param uniformity constant. The Sobel + Laplacian scorer is
// exercised via the exported combineScore helper against synthetic
// numeric fixtures (real ImageScript decode is Deno-only and not used
// from vitest).

import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHARPNESS_MIN_SCORE,
  combineScore,
} from "../../supabase/functions/_shared/coloring/sharpness-gate.ts";

describe("sharpness gate — calibrated threshold", () => {
  it("DEFAULT_SHARPNESS_MIN_SCORE matches owner calibration (8.0)", () => {
    // Ocean Friends owner-cited crisp pages ≥9, blurry ≤6. Floor at 8.0
    // leaves 1.0 headroom for JPEG variance. Do not lower silently.
    expect(DEFAULT_SHARPNESS_MIN_SCORE).toBe(8.0);
  });

  it("crisp page proxy (Sobel≈36, Laplacian≈0) passes the floor", () => {
    // Sobel mean 36 dominates: 36/4 = 9.0 ≥ 8.0.
    expect(combineScore(36, 0)).toBeGreaterThanOrEqual(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("blurry page proxy (Sobel≈16, Laplacian≈0) falls below the floor", () => {
    // 16/4 = 4.0 < 8.0.
    expect(combineScore(16, 0)).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("high-detail page (moderate Sobel + high Laplacian variance) passes", () => {
    // Sobel 20 → 5.0; sqrt(1600)/10 = 4.0; sum = 9.0 ≥ 8.0.
    expect(combineScore(20, 1600)).toBeGreaterThanOrEqual(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("dead-flat page (Sobel≈2, Laplacian≈0) fails", () => {
    expect(combineScore(2, 0)).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("threshold cannot be silently rounded down by float precision", () => {
    expect(DEFAULT_SHARPNESS_MIN_SCORE).toBeGreaterThanOrEqual(8);
  });
});

describe("sharpness gate — score is monotonic", () => {
  it("increasing Sobel with fixed Laplacian never decreases score", () => {
    const a = combineScore(10, 100);
    const b = combineScore(20, 100);
    const c = combineScore(40, 100);
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
  });
  it("increasing Laplacian with fixed Sobel never decreases score", () => {
    const a = combineScore(10, 0);
    const b = combineScore(10, 400);
    const c = combineScore(10, 4000);
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
  });
});
