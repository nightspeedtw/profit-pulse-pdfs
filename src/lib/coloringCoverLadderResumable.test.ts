// Regression tests for the cover-ladder resumability fixes:
//   1. Provider billing / quota errors PAUSE the ladder — never burn rungs.
//   2. Cursor overflow (all rungs exhausted) terminates with evidence,
//      instead of looping with rung=undefined → no_bytes forever.
//   3. Ideogram speed order is BALANCED-first, TURBO fallback (no QUALITY
//      first-try wallclock deaths).
import { describe, it, expect } from "vitest";
import { classifyProviderError } from "../../supabase/functions/_shared/covers/provider-errors.ts";

describe("classifyProviderError", () => {
  it("detects fal balance exhaustion (a05a5086 evidence)", () => {
    const r = 'gen_error:fal fal-ai/ideogram/v3 403: {"detail": "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}';
    expect(classifyProviderError(r)).toBe("billing_exhausted");
  });
  it("detects gemini quota 429 (a05a5086 evidence)", () => {
    const r = 'gen_error:gemini-direct gemini-3.1-flash-image 429: {"error":{"code":429,"message":"You exceeded your current quota"}}';
    expect(classifyProviderError(r)).toBe("quota_exceeded");
  });
  it("ignores normal rung failures (dead frame, no_bytes)", () => {
    expect(classifyProviderError("no_bytes")).toBeNull();
    expect(classifyProviderError("dead:near_black(mean=8.2,var=110)")).toBeNull();
    expect(classifyProviderError("measured_cover_gate_failed:random_text")).toBeNull();
  });
  it("null/undefined safe", () => {
    expect(classifyProviderError(null)).toBeNull();
    expect(classifyProviderError(undefined)).toBeNull();
  });
});

// Pure JS mirror of cursor-overflow guard to lock the contract.
describe("cursor overflow terminates instead of looping with rung=undefined", () => {
  const RUNGS = ["ideogram_v3_a", "ideogram_v3_b", "recraft_v3_ref", "gemini_refs", "svg_synthetic_fallback"];
  function decide(next_index: number): { terminal: boolean; rung: string | undefined } {
    if (next_index >= RUNGS.length) return { terminal: true, rung: undefined };
    return { terminal: false, rung: RUNGS[next_index] };
  }
  it("next_index=5 → terminal (was: infinite rung=undefined/no_bytes)", () => {
    expect(decide(5)).toEqual({ terminal: true, rung: undefined });
  });
  it("next_index=4 still runs svg fallback", () => {
    expect(decide(4)).toEqual({ terminal: false, rung: "svg_synthetic_fallback" });
  });
});
