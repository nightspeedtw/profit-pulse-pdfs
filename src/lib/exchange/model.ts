export const SHARES_PER_BOOK = 1_000_000;
export const BASE_VALUATION_USD = 1_000;
export const BASE_SHARE_PRICE = 0.001;
export const DEFAULT_DEMO_TOPUP_USD = 100;

// Phase 1 buy-only defaults (mirrors platform_settings; UI fetches live values from server)
export const MIN_PURCHASE_USD = 20;
export const BUY_GATEWAY_FEE_PCT = 0.05;
export const BUY_TAX_PCT_DEFAULT = 0.07;

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
  new Intl.NumberFormat("en-US").format(Math.round(n));

export const formatPct = (n: number, digits = 2) =>
  `${(n * 100).toFixed(digits)}%`;

export function pctChange(now: number | null | undefined, then: number | null | undefined): number | null {
  if (!now || !then) return null;
  return (now - then) / then;
}

export interface BuyQuote {
  gross: number;
  fee: number;
  tax: number;
  net: number;
  price: number;
  shares: number;
  ownershipPct: number;         // shares / SHARES_PER_BOOK
  payoutPerSale: (bookSalePriceUsd: number) => number;
  breakEvenSales: (bookSalePriceUsd: number) => number;
}

/**
 * Compute a buy quote for an investment amount at a given ref price and fee/tax pcts.
 * Payout per sale = net_per_sale × shares/SHARES_PER_BOOK
 * where net_per_sale = book_sale_price × (1 - feePct - taxPct).
 */
export function quoteBuy(
  amountGross: number,
  refPrice: number,
  feePct: number,
  taxPct: number
): BuyQuote {
  const gross = Math.max(0, amountGross);
  const fee = +(gross * feePct).toFixed(4);
  const tax = +(gross * taxPct).toFixed(4);
  const net = Math.max(0, gross - fee - tax);
  const shares = refPrice > 0 ? Math.floor(net / refPrice) : 0;
  const ownershipPct = shares / SHARES_PER_BOOK;
  return {
    gross, fee, tax, net, price: refPrice, shares, ownershipPct,
    payoutPerSale: (bookPrice: number) => {
      const netPerSale = bookPrice * (1 - feePct - taxPct);
      return netPerSale * (shares / SHARES_PER_BOOK);
    },
    breakEvenSales: (bookPrice: number) => {
      const netPerSale = bookPrice * (1 - feePct - taxPct);
      const perSale = netPerSale * (shares / SHARES_PER_BOOK);
      return perSale > 0 ? gross / perSale : Infinity;
    },
  };
}
