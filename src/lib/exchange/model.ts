export const SHARES_PER_BOOK = 1_000_000;
export const BASE_VALUATION_USD = 1_000;
export const BASE_SHARE_PRICE = 0.001;
export const DEFAULT_DEMO_TOPUP_USD = 100;

export const formatUsd = (n: number, opts: { min?: number; max?: number } = {}) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.min ?? 2,
    maximumFractionDigits: opts.max ?? 2,
  }).format(n);

export const formatSharePrice = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(n);

export const formatShares = (n: number) =>
  new Intl.NumberFormat("en-US").format(n);

export const formatPct = (n: number, digits = 2) =>
  `${(n * 100).toFixed(digits)}%`;

export function pctChange(now: number | null | undefined, then: number | null | undefined): number | null {
  if (!now || !then) return null;
  return (now - then) / then;
}
