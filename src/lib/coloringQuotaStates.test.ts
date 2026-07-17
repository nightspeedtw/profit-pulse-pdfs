import { describe, it, expect } from "vitest";
import {
  computeQuotaResetWake,
  computeBillingRecheckWake,
  nextUtcMidnight,
  pickParkState,
} from "../../supabase/functions/_shared/coloring/quota-park.ts";

describe("coloring quota-park — provider outage → scheduled wake", () => {
  it("computeQuotaResetWake fires just after next UTC midnight", () => {
    const from = new Date(Date.UTC(2026, 6, 17, 6, 25, 0));
    const wake = computeQuotaResetWake(from);
    const nextMidnight = nextUtcMidnight(from);
    expect(wake.getTime()).toBeGreaterThanOrEqual(nextMidnight.getTime());
    // Jitter window is ≤ 4 minutes past midnight.
    expect(wake.getTime() - nextMidnight.getTime()).toBeLessThan(4 * 60_000);
  });

  it("computeBillingRecheckWake is +30 min for cheap poll", () => {
    const from = new Date(Date.UTC(2026, 6, 17, 6, 25, 0));
    const wake = computeBillingRecheckWake(from);
    expect(wake.getTime() - from.getTime()).toBe(30 * 60_000);
  });

  it("CF quota + FAL healthy → still returns awaiting_quota_reset for the DB write", () => {
    // (Caller would normally route to FAL and not park; this documents the
    // pure-function fallback semantics.)
    const state = pickParkState(
      { cf_locked: true, fal_locked: false },
      "cloudflare @cf/flux-1-schnell 429: you have used up your daily free allocation of 10,000 neurons",
    );
    expect(state).toBe("awaiting_quota_reset");
  });

  it("both providers dry with CF quota trigger → awaiting_quota_reset (deterministic recovery at UTC midnight)", () => {
    const state = pickParkState(
      { cf_locked: true, fal_locked: true },
      "cloudflare @cf/flux-1-schnell 429: daily free allocation of 10,000 neurons",
    );
    expect(state).toBe("awaiting_quota_reset");
  });

  it("FAL billing 403 with CF also dry → awaiting_quota_reset (CF recovers at midnight, FAL top-up may be indefinite)", () => {
    const state = pickParkState(
      { cf_locked: true, fal_locked: true },
      "provider_billing_locked (403): User is locked. Reason: Exhausted balance.",
    );
    expect(state).toBe("awaiting_quota_reset");
  });

  it("FAL billing 403 with CF healthy → awaiting_billing (needs human top-up)", () => {
    const state = pickParkState(
      { cf_locked: false, fal_locked: true },
      "provider_billing_locked (403): User is locked. Reason: Exhausted balance.",
    );
    expect(state).toBe("awaiting_billing");
  });
});
