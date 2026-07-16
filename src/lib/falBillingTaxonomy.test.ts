import { describe, it, expect } from "vitest";
import {
  isFalBillingLocked,
  FalBillingLockedError,
  FalBudgetCapReachedError,
  DEFAULT_FAL_DAILY_BUDGET_USD,
} from "../../supabase/functions/_shared/fal-billing.ts";

describe("fal billing taxonomy — PERMANENT CLASS FIX", () => {
  it("classifies 403 exhausted balance as provider_billing_locked", () => {
    expect(isFalBillingLocked(403, '{"detail":"Exhausted balance. Please top up your account."}')).toBe(true);
  });

  it("classifies 402 as provider_billing_locked", () => {
    expect(isFalBillingLocked(402, "payment required")).toBe(true);
  });

  it("classifies 'user is locked' as provider_billing_locked", () => {
    expect(isFalBillingLocked(403, "User is locked. Contact support.")).toBe(true);
  });

  it("does NOT classify a plain 429 rate limit as billing_locked", () => {
    // Plain quota/rate-limit is transient — stays in the transient bucket,
    // not in the lane-halting billing bucket.
    expect(isFalBillingLocked(429, "Too Many Requests")).toBe(false);
  });

  it("does NOT classify a normal 500 as billing_locked", () => {
    expect(isFalBillingLocked(500, "internal server error")).toBe(false);
  });

  it("FalBillingLockedError carries kind and provider message", () => {
    const err = new FalBillingLockedError(403, "Exhausted balance");
    expect(err.kind).toBe("provider_billing_locked");
    expect(err.family).toBe("temporary_provider_error");
    expect(err.status).toBe(403);
    expect(err.provider_message).toBe("Exhausted balance");
  });

  it("FalBudgetCapReachedError carries spent + cap", () => {
    const err = new FalBudgetCapReachedError(5.12, 5);
    expect(err.kind).toBe("fal_budget_cap_reached");
    expect(err.spent_usd).toBe(5.12);
    expect(err.cap_usd).toBe(5);
  });

  it("default daily budget cap is $5", () => {
    expect(DEFAULT_FAL_DAILY_BUDGET_USD).toBe(5);
  });
});

// SIMULATED end-to-end contract: a billing error MUST NOT increment
// coloring_repair_attempts. Success after the block clears MUST resume from
// stored pages without any attempt-map surgery.
describe("repair-attempt burn prevention — simulated ledger", () => {
  function simulateRender(pageErrors: Array<{ status: number; body: string }>): {
    attempts: Record<string, number>;
    lane_halted: boolean;
  } {
    const attempts: Record<string, number> = {};
    let halted = false;
    for (const err of pageErrors) {
      if (isFalBillingLocked(err.status, err.body)) {
        halted = true;
        break; // lane halts; further pages not dispatched
      }
      attempts["3"] = (attempts["3"] ?? 0) + 1;
    }
    return { attempts, lane_halted: halted };
  }

  it("four consecutive 403 exhausted-balance responses burn ZERO attempts", () => {
    const out = simulateRender([
      { status: 403, body: "Exhausted balance" },
      { status: 403, body: "Exhausted balance" },
      { status: 403, body: "Exhausted balance" },
      { status: 403, body: "Exhausted balance" },
    ]);
    expect(out.attempts["3"] ?? 0).toBe(0);
    expect(out.lane_halted).toBe(true);
  });

  it("genuine content failures still increment attempts", () => {
    const out = simulateRender([
      { status: 500, body: "internal server error" },
      { status: 500, body: "internal server error" },
    ]);
    expect(out.attempts["3"]).toBe(2);
    expect(out.lane_halted).toBe(false);
  });
});
