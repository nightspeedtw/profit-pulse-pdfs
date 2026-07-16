// Regression tests for Defect Class 2 (interior sharpness gate) and
// generation-param uniformity constant. The Sobel + Laplacian scorer is
// exercised via the exported combineScore helper against synthetic
// numeric fixtures (real ImageScript decode is Deno-only and not used
// from vitest).

import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHARPNESS_MIN_SCORE,
  combineScore,
} from "../../supabase/functions/_shared/coloring/sharpness-scoring.ts";

describe("sharpness gate — calibrated threshold", () => {
  it("DEFAULT_SHARPNESS_MIN_SCORE matches Ocean Friends calibration (15.0)", () => {
    // Measured on the Ocean Friends draft at 512px downsample:
    //   owner-flagged blurry interiors 3, 19, 21, 31 scored 11.63, 11.17, 14.84, 10.86
    //   adjacent crisp pages all scored ≥ 15.62
    // Floor at 15.0 catches the flagged set exactly. Do not lower silently.
    expect(DEFAULT_SHARPNESS_MIN_SCORE).toBe(15.0);
  });

  it("crisp page proxy (Sobel≈70, Laplacian≈2000) passes the floor", () => {
    // 70/4 + sqrt(2000)/10 = 17.5 + 4.47 ≈ 22.0
    expect(combineScore(70, 2000)).toBeGreaterThanOrEqual(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("owner-flagged blurry proxy (Sobel≈30, Laplacian≈1200) falls below the floor", () => {
    // 30/4 + sqrt(1200)/10 = 7.5 + 3.46 ≈ 10.96 < 15.0
    expect(combineScore(30, 1200)).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("dead-flat page (Sobel≈2, Laplacian≈0) fails", () => {
    expect(combineScore(2, 0)).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("threshold cannot be silently rounded down by float precision", () => {
    expect(DEFAULT_SHARPNESS_MIN_SCORE).toBeGreaterThanOrEqual(15);
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
