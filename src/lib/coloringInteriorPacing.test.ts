import { describe, it, expect } from "vitest";
import {
  clampBatchToCfBudget,
  DEFAULT_INTERIOR_PACING,
} from "../../supabase/functions/_shared/coloring/interior-pacer.ts";

describe("coloring interior pacer — Cloudflare quota-aware batching", () => {
  it("returns the requested batch when plenty of budget remains", () => {
    expect(clampBatchToCfBudget(6, DEFAULT_INTERIOR_PACING, 0)).toBe(6);
  });

  it("clamps the batch to the remaining budget", () => {
    const cfg = { cf_daily_image_budget: 100, safety_reserve_pct: 0 };
    // 100 budget, 96 used → 4 remaining, request 6 → 4.
    expect(clampBatchToCfBudget(6, cfg, 96)).toBe(4);
  });

  it("returns 0 when the daily budget is fully spent", () => {
    const cfg = { cf_daily_image_budget: 100, safety_reserve_pct: 0 };
    expect(clampBatchToCfBudget(6, cfg, 100)).toBe(0);
    expect(clampBatchToCfBudget(6, cfg, 250)).toBe(0);
  });

  it("respects safety_reserve_pct headroom (never hits the hard cap)", () => {
    const cfg = { cf_daily_image_budget: 100, safety_reserve_pct: 10 };
    // Effective budget = 90 images. 85 used → 5 allowed.
    expect(clampBatchToCfBudget(6, cfg, 85)).toBe(5);
  });

  it("rejects non-positive batch requests", () => {
    expect(clampBatchToCfBudget(0, DEFAULT_INTERIOR_PACING, 0)).toBe(0);
    expect(clampBatchToCfBudget(-3, DEFAULT_INTERIOR_PACING, 0)).toBe(0);
    expect(clampBatchToCfBudget(NaN, DEFAULT_INTERIOR_PACING, 0)).toBe(0);
  });

  it("default budget is well below Cloudflare's 10k daily neuron cap", () => {
    // 750 images * ~12 neurons/img ≈ 9,000 neurons — safe under 10k.
    expect(DEFAULT_INTERIOR_PACING.cf_daily_image_budget).toBeLessThanOrEqual(900);
    expect(DEFAULT_INTERIOR_PACING.safety_reserve_pct).toBeGreaterThan(0);
  });
});
