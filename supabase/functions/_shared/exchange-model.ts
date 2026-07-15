// Royalty Rights Exchange — economic constants + reference-price math.
// Mirror of src/lib/exchange/model.ts. Keep in lockstep.

export const SHARES_PER_BOOK = 1_000_000;
export const BASE_VALUATION_USD = 1_000;
export const BASE_SHARE_PRICE = BASE_VALUATION_USD / SHARES_PER_BOOK; // 0.001
export const REV_MULTIPLE = 4;
export const MOMENTUM_FLOOR = 0.8;
export const MOMENTUM_CEIL = 1.5;
export const DEFAULT_DEMO_TOPUP_USD = 100;

export function computeRefPrice(opts: {
  trailing90dNetRev: number;
  salesRankPercentile: number; // 0..1
  hasSales: boolean;
}): number {
  const raw = (BASE_VALUATION_USD + opts.trailing90dNetRev * REV_MULTIPLE) / SHARES_PER_BOOK;
  const momentumRaw = 1 + 0.10 * opts.salesRankPercentile;
  const momentum = opts.hasSales
    ? Math.min(MOMENTUM_CEIL, Math.max(1.0, momentumRaw))
    : MOMENTUM_FLOOR;
  return Math.max(BASE_SHARE_PRICE, raw * momentum);
}

export function computeRoyaltyPools(opts: {
  saleUsd: number;
  feePct: number;
  taxPct: number;
  creatorPoolPct: number;
  hasCreator: boolean;
}) {
  const gross = Math.max(0, opts.saleUsd);
  const netAfterFees = gross * (1 - opts.feePct - opts.taxPct);
  const creator = opts.hasCreator ? netAfterFees * opts.creatorPoolPct : 0;
  const shareholderPool = netAfterFees - creator;
  return { gross, netAfterFees, creator, shareholderPool };
}
