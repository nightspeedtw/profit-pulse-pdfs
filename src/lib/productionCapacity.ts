// Production capacity calculator for the Production Command Center.
// Pure computation — does not start production, does not lower QC gates.
export type CapacityInput = {
  dailyCostCapUsd: number;
  costUsedToday: number;
  maxBooksPerDay: number;
  maxParallelBooks: number;
  minimumQcPassRate: number;
  booksStartedToday: number;
  recentAvgCostPerBook: number | null;
  recentAvgMinutesPerBook: number | null;
  recentQcPassRate: number | null;
  activeQueueCount: number;
  inProgressCount: number;
  eligibleIdeas: number;
  paused: boolean;
  autopilotEnabled: boolean;
  costLimitReached: boolean;
  enabledCategoryCount: number;
};

export type CapacityResult = {
  recommendedStartsToday: number;
  budgetLimitedCapacity: number;
  timeLimitedCapacity: number;
  queueLimitedCapacity: number;
  perBookCostEstimate: number;
  autopilotState:
    | "running"
    | "paused"
    | "cost_limited"
    | "qc_limited"
    | "needs_admin_attention"
    | "disabled"
    | "no_categories";
  qcThrottleFactor: number; // 0, 0.5, or 1
  warnings: string[];
};

const FALLBACK_COST = 0.75; // conservative $ per premium ebook
const FALLBACK_MINUTES = 20;

const safeNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const safeFloor = (v: number): number => {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
};

export function computeCapacity(i: CapacityInput): CapacityResult {
  const warnings: string[] = [];
  const dailyCostCap = Math.max(0, safeNum(i.dailyCostCapUsd));
  const costUsedToday = Math.max(0, safeNum(i.costUsedToday));
  const maxBooksPerDay = Math.max(0, safeFloor(safeNum(i.maxBooksPerDay)));
  const booksStartedToday = Math.max(0, safeFloor(safeNum(i.booksStartedToday)));
  const eligibleIdeas = Math.max(0, safeFloor(safeNum(i.eligibleIdeas)));
  const minimumQcPassRate = Math.max(0, safeNum(i.minimumQcPassRate, 80));

  const rawAvgCost = safeNum(i.recentAvgCostPerBook, 0);
  const perBookCostEstimate = rawAvgCost > 0 ? rawAvgCost : FALLBACK_COST;
  const rawAvgMin = safeNum(i.recentAvgMinutesPerBook, 0);
  const avgMinutes = rawAvgMin > 0 ? rawAvgMin : FALLBACK_MINUTES;

  const remainingBudget = Math.max(0, dailyCostCap - costUsedToday);
  const budgetLimitedCapacity = safeFloor(remainingBudget / perBookCostEstimate);

  // Time-limited: how many books fit in the remaining day given parallelism.
  const now = new Date();
  const endOfDay = new Date(now); endOfDay.setUTCHours(23, 59, 59, 999);
  const remainingMinutes = Math.max(0, (endOfDay.getTime() - now.getTime()) / 60000);
  const parallel = Math.max(1, safeFloor(safeNum(i.maxParallelBooks, 1)));
  const timeLimitedCapacity = safeFloor((remainingMinutes / avgMinutes) * parallel);

  const dailyRemaining = Math.max(0, maxBooksPerDay - booksStartedToday);
  const queueLimitedCapacity = eligibleIdeas;

  // QC throttle
  const passRate = i.recentQcPassRate ?? 100;
  let qcThrottleFactor = 1;
  let autopilotState: CapacityResult["autopilotState"] = "running";

  if (!i.autopilotEnabled) autopilotState = "disabled";
  else if (i.paused) autopilotState = "paused";
  else if (i.costLimitReached || remainingBudget <= 0) autopilotState = "cost_limited";
  else if (i.enabledCategoryCount === 0) autopilotState = "no_categories";
  else if (passRate < minimumQcPassRate) autopilotState = "qc_limited";

  if (passRate < 70) {
    qcThrottleFactor = 0;
    warnings.push(`Recent QC pass rate ${passRate.toFixed(0)}% is below 70%. Production paused.`);
  } else if (passRate < 85) {
    qcThrottleFactor = 0.5;
    warnings.push(`Recent QC pass rate ${passRate.toFixed(0)}% below 85% — starts halved.`);
  }

  if (remainingBudget <= 0) warnings.push("Daily cost cap reached.");
  if (i.enabledCategoryCount === 0) warnings.push("No categories enabled. Enable at least one category.");
  if (i.inProgressCount >= i.maxParallelBooks) warnings.push("Parallel run limit already reached.");
  if (i.eligibleIdeas < 3) warnings.push("Idea pool low — generate more ideas.");

  const rawCapacity = Math.min(
    budgetLimitedCapacity,
    timeLimitedCapacity,
    dailyRemaining,
    queueLimitedCapacity,
  );
  const throttled = safeFloor(rawCapacity * qcThrottleFactor);
  const recommendedStartsToday = autopilotState === "running"
    ? Math.max(0, throttled)
    : 0;

  return {
    recommendedStartsToday,
    budgetLimitedCapacity,
    timeLimitedCapacity,
    queueLimitedCapacity,
    perBookCostEstimate,
    autopilotState,
    qcThrottleFactor,
    warnings,
  };
}

export type CategoryMixEntry = {
  slug: string;
  weight: number;
  enabled: boolean;
};

/**
 * Weighted round-robin picker.
 * Avoids picking the same category more than 2x in a row unless only one is enabled.
 */
export function pickNextCategory(
  mix: CategoryMixEntry[],
  recentPicks: string[],
): string | null {
  const enabled = mix.filter((m) => m.enabled && m.weight > 0);
  if (enabled.length === 0) return null;
  if (enabled.length === 1) return enabled[0].slug;

  const lastTwo = recentPicks.slice(-2);
  const bannedRepeat = lastTwo.length === 2 && lastTwo[0] === lastTwo[1] ? lastTwo[0] : null;

  const candidates = enabled.filter((e) => e.slug !== bannedRepeat);
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return enabled[0].slug;

  // Deterministic-ish weighted pick using recent history offset
  const offset = recentPicks.length;
  let ticket = (offset * 7 + 3) % total;
  for (const c of candidates) {
    if (ticket < c.weight) return c.slug;
    ticket -= c.weight;
  }
  return candidates[0].slug;
}
