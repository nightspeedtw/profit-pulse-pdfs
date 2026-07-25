import { describe, it, expect } from "vitest";
import {
  isColoringV2BookParked,
  pickClosestColoringV2Book,
} from "../../supabase/functions/_shared/coloring-v2/one-book.ts";

// Regression: 2026-07-25 — Flutterwing Fairy Friends burned 95 attempts at
// interior_render because pickClosestColoringV2Book kept selecting it even
// though every Cloudflare account was daily-latched. The park mechanism
// must skip such books until their wake time.
describe("coloring-v2 one-book — parked books are skipped", () => {
  const NOW = new Date("2026-07-25T14:00:00Z");
  const WAKE_FUTURE = "2026-07-26T00:02:00Z"; // next CF reset
  const WAKE_PAST = "2026-07-25T10:00:00Z";

  it("isColoringV2BookParked returns true for awaiting_quota_reset with future wake", () => {
    expect(isColoringV2BookParked({
      id: "b1", stage: "interior_render",
      last_error: "awaiting_quota_reset:cloudflare: all 7 accounts daily-latched",
      stage_updated_at: WAKE_FUTURE,
    }, NOW)).toBe(true);
  });

  it("isColoringV2BookParked returns false once wake has passed", () => {
    expect(isColoringV2BookParked({
      id: "b1", stage: "interior_render",
      last_error: "awaiting_quota_reset:cloudflare",
      stage_updated_at: WAKE_PAST,
    }, NOW)).toBe(false);
  });

  it("isColoringV2BookParked ignores rows without the park prefix", () => {
    expect(isColoringV2BookParked({
      id: "b1", stage: "interior_render",
      last_error: "provider_billing_locked (429): raw",
      stage_updated_at: WAKE_FUTURE,
    }, NOW)).toBe(false);
  });

  it("pickClosestColoringV2Book skips the closest-to-done book when it is parked", () => {
    const parkedNearDone = {
      id: "flutterwing", stage: "interior_render",
      interiors_done: 31, page_count: 32,
      last_error: "awaiting_quota_reset:cloudflare: all 7 accounts daily-latched",
      stage_updated_at: WAKE_FUTURE,
      updated_at: "2026-07-25T13:59:00Z",
    };
    const nextClean = {
      id: "clean-cover", stage: "cover",
      updated_at: "2026-07-25T12:00:00Z",
    };
    const picked = pickClosestColoringV2Book([parkedNearDone, nextClean], NOW);
    expect(picked?.id).toBe("clean-cover");
  });

  it("returns null when every candidate is parked (tick will fall through to queued)", () => {
    const rows = [
      { id: "a", stage: "interior_render", last_error: "awaiting_quota_reset:x", stage_updated_at: WAKE_FUTURE },
      { id: "b", stage: "cover", last_error: "awaiting_billing:x", stage_updated_at: WAKE_FUTURE },
    ];
    expect(pickClosestColoringV2Book(rows, NOW)).toBeNull();
  });
});
