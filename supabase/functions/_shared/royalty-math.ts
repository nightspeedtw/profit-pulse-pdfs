// Royalty Ownership — server-side math.
//
// All money uses string-decimal arithmetic (delegated to Number for the
// small magnitudes we handle, but rounded aggressively to eliminate
// float drift). Never trust client-computed values; always recompute
// from the DB-loaded `book_royalty_markets` row.

export interface MarketRow {
  total_units: number;
  units_available: number;
  current_indicative_unit_price_usd: number;
  royalty_pool_percent: number;
  minimum_purchase_usd: number;
  thai_vat_rate: number;
  gateway_fee_rate: number;
  sales_vat_rate: number;
  sales_gateway_fee_rate: number;
  book_sale_price_usd: number;
  valuation_multiple: number;
  initial_book_value_usd: number;
  max_daily_value_change: number;
}

export interface QuoteInput {
  market: MarketRow;
  requested_usd?: number | null;
  requested_units?: number | null;
}

export interface QuoteResult {
  ok: true;
  units: number;
  unit_price: number;
  subtotal_usd: number;
  vat_usd: number;
  gateway_fee_usd: number;
  total_payment_usd: number;
  ownership_percentage: number;
  estimated_royalty_per_sale: number;
  estimated_break_even_sales_subtotal: number;
  estimated_break_even_sales_total: number;
}

export type QuoteError =
  | { ok: false; code: "invalid_input"; message: string }
  | { ok: false; code: "below_minimum"; message: string; minimum_usd: number }
  | { ok: false; code: "insufficient_supply"; message: string; units_available: number }
  | { ok: false; code: "market_inactive"; message: string };

const ROUND_MONEY = 4;   // 4 decimal places on money
const ROUND_UNITS = 8;   // 8 decimal places on per-unit price

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function money(n: number): number {
  return round(n, ROUND_MONEY);
}

/**
 * Compute a fresh quote from the market row.
 * Users may pass either requested_usd OR requested_units; we sync both.
 */
export function computeQuote(input: QuoteInput): QuoteResult | QuoteError {
  const m = input.market;
  if (m.current_indicative_unit_price_usd <= 0) {
    return { ok: false, code: "invalid_input", message: "market has no unit price" };
  }
  const unitPrice = m.current_indicative_unit_price_usd;

  let units: number;
  if (typeof input.requested_units === "number" && input.requested_units > 0) {
    units = Math.floor(input.requested_units);
  } else if (typeof input.requested_usd === "number" && input.requested_usd > 0) {
    // requested_usd is interpreted as SUBTOTAL (before VAT/fees), matching the
    // owner spec example ($20 subtotal → 20,000 units).
    units = Math.floor(input.requested_usd / unitPrice);
  } else {
    return { ok: false, code: "invalid_input", message: "requested_usd or requested_units required" };
  }

  if (units <= 0) {
    return { ok: false, code: "invalid_input", message: "units must be positive" };
  }

  const subtotal = money(units * unitPrice);
  if (subtotal < m.minimum_purchase_usd - 1e-9) {
    return {
      ok: false,
      code: "below_minimum",
      message: `Minimum Royalty Unit purchase is $${m.minimum_purchase_usd} before tax and fees.`,
      minimum_usd: m.minimum_purchase_usd,
    };
  }

  if (units > m.units_available) {
    return {
      ok: false,
      code: "insufficient_supply",
      message: `Only ${m.units_available.toLocaleString()} Royalty Units remain for this book.`,
      units_available: m.units_available,
    };
  }

  const vat = money(subtotal * m.thai_vat_rate);
  const gatewayFee = money((subtotal + vat) * m.gateway_fee_rate);
  const total = money(subtotal + vat + gatewayFee);

  const ownershipPct = round((units / m.total_units) * 100, 6);

  // One-sale royalty estimate at the current book_sale_price.
  const oneSale = computeOneSaleEconomics({ market: m, ownership_percentage: ownershipPct });
  const royaltyPerSale = oneSale.user_royalty_per_sale;

  const bevSubtotal = royaltyPerSale > 0 ? Math.ceil(subtotal / royaltyPerSale) : 0;
  const bevTotal = royaltyPerSale > 0 ? Math.ceil(total / royaltyPerSale) : 0;

  return {
    ok: true,
    units,
    unit_price: round(unitPrice, ROUND_UNITS),
    subtotal_usd: subtotal,
    vat_usd: vat,
    gateway_fee_usd: gatewayFee,
    total_payment_usd: total,
    ownership_percentage: ownershipPct,
    estimated_royalty_per_sale: round(royaltyPerSale, 6),
    estimated_break_even_sales_subtotal: bevSubtotal,
    estimated_break_even_sales_total: bevTotal,
  };
}

export interface OneSaleEconomics {
  gross: number;
  sale_vat: number;
  sale_gateway_fee: number;
  net_sale_revenue: number;
  distributable_royalty: number;
  user_royalty_per_sale: number;
}

export function computeOneSaleEconomics(opts: {
  market: MarketRow;
  ownership_percentage: number; // in percent, e.g. 2 = 2%
  refunds?: number;
  chargebacks?: number;
}): OneSaleEconomics {
  const m = opts.market;
  const gross = m.book_sale_price_usd;
  const saleVat = money(gross * m.sales_vat_rate);
  const saleFee = money((gross + saleVat) * m.sales_gateway_fee_rate);
  const net = money(gross - saleVat - saleFee - (opts.refunds ?? 0) - (opts.chargebacks ?? 0));
  const distributable = money(net * m.royalty_pool_percent);
  const userRoyalty = round(distributable * (opts.ownership_percentage / 100), 6);
  return {
    gross,
    sale_vat: saleVat,
    sale_gateway_fee: saleFee,
    net_sale_revenue: net,
    distributable_royalty: distributable,
    user_royalty_per_sale: userRoyalty,
  };
}

export function computeBreakEven(opts: {
  subtotal: number;
  total_payment: number;
  royalty_per_sale: number;
}): { break_even_subtotal: number; break_even_total: number } {
  if (opts.royalty_per_sale <= 0) return { break_even_subtotal: 0, break_even_total: 0 };
  return {
    break_even_subtotal: Math.ceil(opts.subtotal / opts.royalty_per_sale),
    break_even_total: Math.ceil(opts.total_payment / opts.royalty_per_sale),
  };
}

export interface ValuationInputs {
  market: MarketRow;
  trailing_7d_net_sales: number;
  trailing_30d_net_sales: number;
  trailing_90d_net_sales: number;
  quality_adjustment?: number; // 0.80–1.20
  growth_adjustment?: number;  // 0.80–1.50
  refund_adjustment?: number;  // 0.70–1.00
  previous_indicative_book_value?: number;
}

export function computeIndicativeValuation(inp: ValuationInputs): {
  indicative_book_value: number;
  indicative_unit_value: number;
  clamped: boolean;
  calculation: Record<string, unknown>;
} {
  const m = inp.market;
  const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) =>
    Math.min(hi, Math.max(lo, v ?? dflt));
  const qAdj = clamp(inp.quality_adjustment, 0.80, 1.20, 1.0);
  const gAdj = clamp(inp.growth_adjustment, 0.80, 1.50, 1.0);
  const rAdj = clamp(inp.refund_adjustment, 0.70, 1.00, 1.0);
  const performance = Math.max(m.initial_book_value_usd, inp.trailing_90d_net_sales * m.valuation_multiple);
  let indicative = money(performance * qAdj * gAdj * rAdj);
  let clamped = false;
  if (inp.previous_indicative_book_value && inp.previous_indicative_book_value > 0) {
    const maxUp = inp.previous_indicative_book_value * (1 + m.max_daily_value_change);
    const maxDown = inp.previous_indicative_book_value * (1 - m.max_daily_value_change);
    if (indicative > maxUp) { indicative = money(maxUp); clamped = true; }
    if (indicative < maxDown) { indicative = money(maxDown); clamped = true; }
  }
  const unitValue = round(indicative / m.total_units, ROUND_UNITS);
  return {
    indicative_book_value: indicative,
    indicative_unit_value: unitValue,
    clamped,
    calculation: {
      performance,
      quality_adjustment: qAdj,
      growth_adjustment: gAdj,
      refund_adjustment: rAdj,
      trailing_90d_net_sales: inp.trailing_90d_net_sales,
      valuation_multiple: m.valuation_multiple,
    },
  };
}
