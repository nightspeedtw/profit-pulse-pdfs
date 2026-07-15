// Client-side mirror of the server royalty math.
//
// Used ONLY for live calculator previews while the user types. Every
// commit (Reserve, Buy) MUST call the server which recomputes from DB.

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
  initial_book_value_usd: number;
  current_indicative_book_value_usd: number;
}

const money = (n: number) => Math.round(n * 10000) / 10000;

export function computePreview(m: MarketRow, requested: { usd?: number; units?: number }) {
  const price = m.current_indicative_unit_price_usd;
  if (price <= 0) return null;
  let units = 0;
  if (requested.units && requested.units > 0) units = Math.floor(requested.units);
  else if (requested.usd && requested.usd > 0) units = Math.floor(requested.usd / price);
  if (units <= 0) return null;

  const subtotal = money(units * price);
  const vat = money(subtotal * m.thai_vat_rate);
  const fee = money((subtotal + vat) * m.gateway_fee_rate);
  const total = money(subtotal + vat + fee);
  const ownershipPct = Math.round((units / m.total_units) * 100 * 1e6) / 1e6;

  // one-sale royalty
  const gross = m.book_sale_price_usd;
  const saleVat = money(gross * m.sales_vat_rate);
  const saleFee = money((gross + saleVat) * m.sales_gateway_fee_rate);
  const net = money(gross - saleVat - saleFee);
  const distributable = money(net * m.royalty_pool_percent);
  const royaltyPerSale = Math.round(distributable * (ownershipPct / 100) * 1e6) / 1e6;
  const bevSubtotal = royaltyPerSale > 0 ? Math.ceil(subtotal / royaltyPerSale) : 0;
  const bevTotal = royaltyPerSale > 0 ? Math.ceil(total / royaltyPerSale) : 0;

  return {
    units,
    unit_price: price,
    subtotal,
    vat,
    gateway_fee: fee,
    total,
    ownership_percentage: ownershipPct,
    below_minimum: subtotal < m.minimum_purchase_usd - 1e-9,
    supply_exceeded: units > m.units_available,
    one_sale: {
      gross,
      sale_vat: saleVat,
      sale_gateway_fee: saleFee,
      net_sale_revenue: net,
      distributable_royalty: distributable,
      user_royalty_per_sale: royaltyPerSale,
    },
    break_even: {
      subtotal: bevSubtotal,
      total: bevTotal,
    },
  };
}

export const usd = (n: number, dp = 2) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);

export const num = (n: number) => new Intl.NumberFormat('en-US').format(n);

export const pct = (n: number, dp = 2) => `${n.toFixed(dp)}%`;
