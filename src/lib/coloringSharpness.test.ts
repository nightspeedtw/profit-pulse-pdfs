// Regression tests for Defect Class 2 (interior sharpness gate).
// The Sobel + Laplacian scorer is exercised via combineScore against
// synthetic numeric fixtures (real ImageScript decode is Deno-only).

import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHARPNESS_MIN_SCORE,
  combineScore,
} from "../../supabase/functions/_shared/coloring/sharpness-scoring.ts";

// Full 30-page accepted-set audit of Ocean Friends (a05a5086) computed
// with the production scorer. Persisted as a regression fixture so the
// floor can never drift silently past the known-crisp/known-blurry
// boundary. The accepted set MUST all pass; the blurry sets MUST all fail.
const OCEAN_FRIENDS_ACCEPTED_MIN = 13.55;   // page 3
const OCEAN_FRIENDS_BLURRY_SET = [4.0, 4.2, 5.5, 3.8]; // p7/p23/p25/p35
const OCEAN_FRIENDS_REGEN_FAILS = [11.28, 10.24];      // p19/p31 after replan

describe("sharpness gate — calibrated threshold (v3, 2026-07-16)", () => {
  it("floor is 13.0 — just below accepted-crisp minimum (13.55)", () => {
    expect(DEFAULT_SHARPNESS_MIN_SCORE).toBe(13.0);
  });

  it("accepts every page of the accepted-crisp fixture set", () => {
    expect(OCEAN_FRIENDS_ACCEPTED_MIN).toBeGreaterThanOrEqual(DEFAULT_SHARPNESS_MIN_SCORE);
  });

  it("still rejects the owner-flagged blurry set p7/p23/p25/p35", () => {
    for (const s of OCEAN_FRIENDS_BLURRY_SET) {
      expect(s).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
    }
  });

  it("still rejects the failing repair regens (p19/p31 after replan)", () => {
    for (const s of OCEAN_FRIENDS_REGEN_FAILS) {
      expect(s).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
    }
  });
});

describe("sharpness gate — score function", () => {
  it("crisp page proxy passes the floor", () => {
    expect(combineScore(70, 2000)).toBeGreaterThanOrEqual(DEFAULT_SHARPNESS_MIN_SCORE);
  });
  it("dead-flat page fails", () => {
    expect(combineScore(2, 0)).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
  });
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
