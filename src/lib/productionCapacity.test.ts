import { describe, it, expect } from "vitest";
import { computeCapacity, pickNextCategory, type CapacityInput } from "./productionCapacity";

const base: CapacityInput = {
  dailyCostCapUsd: 10,
  costUsedToday: 0,
  maxBooksPerDay: 5,
  maxParallelBooks: 2,
  minimumQcPassRate: 80,
  booksStartedToday: 0,
  recentAvgCostPerBook: 0.5,
  recentAvgMinutesPerBook: 15,
  recentQcPassRate: 95,
  activeQueueCount: 0,
  inProgressCount: 0,
  eligibleIdeas: 10,
  paused: false,
  autopilotEnabled: true,
  costLimitReached: false,
  enabledCategoryCount: 3,
};

describe("computeCapacity — safety", () => {
  it("never returns NaN/Infinity/negative with garbage inputs", () => {
    const r = computeCapacity({
      ...base,
      dailyCostCapUsd: NaN as unknown as number,
      recentAvgCostPerBook: 0,
      recentAvgMinutesPerBook: 0,
      maxBooksPerDay: -5,
      maxParallelBooks: NaN as unknown as number,
      eligibleIdeas: -1,
    });
    expect(Number.isFinite(r.recommendedStartsToday)).toBe(true);
    expect(r.recommendedStartsToday).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.budgetLimitedCapacity)).toBe(true);
    expect(Number.isFinite(r.timeLimitedCapacity)).toBe(true);
  });

  it("returns 0 starts when cost cap reached", () => {
    const r = computeCapacity({ ...base, costLimitReached: true });
    expect(r.recommendedStartsToday).toBe(0);
    expect(r.autopilotState).toBe("cost_limited");
  });

  it("returns 0 starts when budget exhausted", () => {
    const r = computeCapacity({ ...base, costUsedToday: 20 });
    expect(r.recommendedStartsToday).toBe(0);
    expect(r.autopilotState).toBe("cost_limited");
  });

  it("throttles to 0 when QC pass rate < 70", () => {
    const r = computeCapacity({ ...base, recentQcPassRate: 50 });
    expect(r.qcThrottleFactor).toBe(0);
    expect(r.recommendedStartsToday).toBe(0);
  });

  it("halves starts when QC pass rate < 85", () => {
    const r = computeCapacity({ ...base, recentQcPassRate: 80 });
    expect(r.qcThrottleFactor).toBe(0.5);
  });

  it("returns 0 when paused", () => {
    const r = computeCapacity({ ...base, paused: true });
    expect(r.recommendedStartsToday).toBe(0);
    expect(r.autopilotState).toBe("paused");
  });

  it("returns 0 when disabled", () => {
    const r = computeCapacity({ ...base, autopilotEnabled: false });
    expect(r.recommendedStartsToday).toBe(0);
    expect(r.autopilotState).toBe("disabled");
  });

  it("returns 0 when no categories enabled", () => {
    const r = computeCapacity({ ...base, enabledCategoryCount: 0 });
    expect(r.recommendedStartsToday).toBe(0);
    expect(r.autopilotState).toBe("no_categories");
  });
});

describe("pickNextCategory", () => {
  const mix = [
    { slug: "finance", weight: 2, enabled: true },
    { slug: "wellness", weight: 1, enabled: true },
    { slug: "beginner", weight: 1, enabled: true },
  ];

  it("returns null when nothing enabled", () => {
    expect(pickNextCategory([{ slug: "a", weight: 1, enabled: false }], [])).toBeNull();
  });

  it("returns the only enabled category", () => {
    expect(pickNextCategory([{ slug: "a", weight: 1, enabled: true }], ["a", "a", "a"])).toBe("a");
  });

  it("avoids 3-in-a-row when others are enabled", () => {
    const picked = pickNextCategory(mix, ["finance", "finance"]);
    expect(picked).not.toBe("finance");
  });
});
