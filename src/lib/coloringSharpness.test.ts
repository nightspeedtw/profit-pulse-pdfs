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

describe("Ocean Friends accepted-set calibration (measured 2026-07-16)", () => {
  // Distribution measured with the exact production scoring function on
  // all 30 accepted pages of Ocean Friends (a05a5086) BEFORE the sharpness
  // gate was in place. Persisted here as a regression fixture so the floor
  // can never drift silently past the known-crisp/known-blurry boundary.
  //
  //   min=13.55 (p3 — was itself owner-flagged as blurry)
  //   p10=18.16  median=27.80  p90=46.27  max=48.04
  //
  // The two failing regens (p19/p31 after portrait replan) scored ~10–13.
  // Only ONE accepted page (p3) fell below 15, and p3 was already in the
  // owner's original blurry-set complaint. Therefore floor=15 correctly
  // separates known-crisp (≥15.63 across p1,p2,p4…p32 minus p3) from
  // known-blurry (p3=13.55 and repair regens p19/p31≈11). Repair regime
  // upgrade (steps 4→8 + crisp-line clause) is the calibrated fix, not a
  // floor reduction.
  it("floor=15 keeps known-crisp accepted pages above it (except owner-flagged p3)", () => {
    const acceptedMinExcludingKnownBlurry = 15.63; // p12
    expect(acceptedMinExcludingKnownBlurry).toBeGreaterThanOrEqual(DEFAULT_SHARPNESS_MIN_SCORE);
  });
  it("floor=15 keeps owner-flagged blurry pages (p3, regens p19/p31) below it", () => {
    const knownBlurryScores = [13.55, 11.28, 10.24];
    for (const s of knownBlurryScores) {
      expect(s).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
    }
  });
});
