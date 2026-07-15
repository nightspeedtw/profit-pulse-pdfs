
-- =============================================
-- Royalty Ownership — buy-only, simulated phase
-- =============================================

CREATE TYPE public.royalty_market_status AS ENUM ('active','paused','closed');
CREATE TYPE public.royalty_quote_status AS ENUM ('draft','quoted','awaiting_payment','reserved','simulated_completed','cancelled','expired');
CREATE TYPE public.royalty_sale_status AS ENUM ('recorded','refunded','charged_back');
CREATE TYPE public.royalty_earning_status AS ENUM ('recorded','paid','reversed');

-- ---- book_royalty_markets ----
CREATE TABLE public.book_royalty_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL UNIQUE,
  total_units BIGINT NOT NULL DEFAULT 1000000,
  units_available BIGINT NOT NULL DEFAULT 1000000,
  initial_book_value_usd NUMERIC(18,4) NOT NULL DEFAULT 1000,
  initial_unit_price_usd NUMERIC(18,8) NOT NULL DEFAULT 0.001,
  current_indicative_book_value_usd NUMERIC(18,4) NOT NULL DEFAULT 1000,
  current_indicative_unit_price_usd NUMERIC(18,8) NOT NULL DEFAULT 0.001,
  royalty_pool_percent NUMERIC(6,4) NOT NULL DEFAULT 0.50,
  minimum_purchase_usd NUMERIC(18,4) NOT NULL DEFAULT 20,
  thai_vat_rate NUMERIC(6,4) NOT NULL DEFAULT 0.07,
  gateway_fee_rate NUMERIC(6,4) NOT NULL DEFAULT 0.05,
  sales_vat_rate NUMERIC(6,4) NOT NULL DEFAULT 0.07,
  sales_gateway_fee_rate NUMERIC(6,4) NOT NULL DEFAULT 0.05,
  book_sale_price_usd NUMERIC(18,4) NOT NULL DEFAULT 9.99,
  valuation_multiple NUMERIC(6,2) NOT NULL DEFAULT 3.0,
  max_daily_value_change NUMERIC(6,4) NOT NULL DEFAULT 0.10,
  status public.royalty_market_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.book_royalty_markets TO anon, authenticated;
GRANT ALL ON public.book_royalty_markets TO service_role;
ALTER TABLE public.book_royalty_markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view royalty markets" ON public.book_royalty_markets FOR SELECT USING (true);
CREATE POLICY "Admins manage royalty markets" ON public.book_royalty_markets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_book_royalty_markets_updated_at BEFORE UPDATE ON public.book_royalty_markets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_brm_book_id ON public.book_royalty_markets(book_id);

-- ---- royalty_purchase_quotes ----
CREATE TABLE public.royalty_purchase_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,
  requested_usd NUMERIC(18,4),
  unit_price NUMERIC(18,8) NOT NULL,
  units BIGINT NOT NULL,
  ownership_percentage NUMERIC(10,6) NOT NULL,
  subtotal_usd NUMERIC(18,4) NOT NULL,
  vat_usd NUMERIC(18,4) NOT NULL,
  gateway_fee_usd NUMERIC(18,4) NOT NULL,
  total_payment_usd NUMERIC(18,4) NOT NULL,
  estimated_royalty_per_sale NUMERIC(18,6) NOT NULL,
  estimated_break_even_sales_subtotal BIGINT NOT NULL,
  estimated_break_even_sales_total BIGINT NOT NULL,
  status public.royalty_quote_status NOT NULL DEFAULT 'quoted',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.royalty_purchase_quotes TO authenticated;
GRANT ALL ON public.royalty_purchase_quotes TO service_role;
ALTER TABLE public.royalty_purchase_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own quotes" ON public.royalty_purchase_quotes FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create own quotes" ON public.royalty_purchase_quotes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_royalty_purchase_quotes_updated_at BEFORE UPDATE ON public.royalty_purchase_quotes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_rpq_user_book ON public.royalty_purchase_quotes(user_id, book_id);

-- ---- royalty_holdings ----
CREATE TABLE public.royalty_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,
  units_owned BIGINT NOT NULL DEFAULT 0,
  ownership_percentage NUMERIC(10,6) NOT NULL DEFAULT 0,
  average_unit_cost NUMERIC(18,8) NOT NULL DEFAULT 0,
  subtotal_invested_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_vat_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_gateway_fee_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_paid_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  lifetime_royalty_earned NUMERIC(18,4) NOT NULL DEFAULT 0,
  pending_royalty NUMERIC(18,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, book_id)
);
GRANT SELECT ON public.royalty_holdings TO authenticated;
GRANT ALL ON public.royalty_holdings TO service_role;
ALTER TABLE public.royalty_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own holdings" ON public.royalty_holdings FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_royalty_holdings_updated_at BEFORE UPDATE ON public.royalty_holdings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_rh_user ON public.royalty_holdings(user_id);
CREATE INDEX idx_rh_book ON public.royalty_holdings(book_id);

-- ---- book_sales_ledger (IMMUTABLE) ----
CREATE TABLE public.book_sales_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL,
  order_id UUID,
  sale_price_usd NUMERIC(18,4) NOT NULL,
  vat_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  gateway_fee_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  refund_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  chargeback_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  net_revenue_usd NUMERIC(18,4) NOT NULL,
  royalty_pool_usd NUMERIC(18,4) NOT NULL,
  sale_status public.royalty_sale_status NOT NULL DEFAULT 'recorded',
  sold_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.book_sales_ledger TO anon, authenticated;
GRANT ALL ON public.book_sales_ledger TO service_role;
ALTER TABLE public.book_sales_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view sales ledger" ON public.book_sales_ledger FOR SELECT USING (true);
CREATE INDEX idx_bsl_book_sold ON public.book_sales_ledger(book_id, sold_at DESC);

-- ---- royalty_earnings_ledger (IMMUTABLE) ----
CREATE TABLE public.royalty_earnings_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,
  holding_id UUID,
  sale_ledger_id UUID NOT NULL REFERENCES public.book_sales_ledger(id) ON DELETE CASCADE,
  units_owned_at_sale BIGINT NOT NULL,
  ownership_percentage_at_sale NUMERIC(10,6) NOT NULL,
  distributable_royalty_pool_usd NUMERIC(18,4) NOT NULL,
  royalty_earned_usd NUMERIC(18,6) NOT NULL,
  status public.royalty_earning_status NOT NULL DEFAULT 'recorded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.royalty_earnings_ledger TO authenticated;
GRANT ALL ON public.royalty_earnings_ledger TO service_role;
ALTER TABLE public.royalty_earnings_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own earnings" ON public.royalty_earnings_ledger FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_rel_user_book ON public.royalty_earnings_ledger(user_id, book_id);
CREATE INDEX idx_rel_sale ON public.royalty_earnings_ledger(sale_ledger_id);

-- ---- book_valuation_snapshots ----
CREATE TABLE public.book_valuation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL,
  initial_value NUMERIC(18,4) NOT NULL,
  trailing_7d_net_sales NUMERIC(18,4) NOT NULL DEFAULT 0,
  trailing_30d_net_sales NUMERIC(18,4) NOT NULL DEFAULT 0,
  trailing_90d_net_sales NUMERIC(18,4) NOT NULL DEFAULT 0,
  valuation_multiple NUMERIC(6,2) NOT NULL,
  quality_adjustment NUMERIC(6,4) NOT NULL DEFAULT 1,
  growth_adjustment NUMERIC(6,4) NOT NULL DEFAULT 1,
  refund_adjustment NUMERIC(6,4) NOT NULL DEFAULT 1,
  indicative_book_value NUMERIC(18,4) NOT NULL,
  indicative_unit_value NUMERIC(18,8) NOT NULL,
  calculation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(book_id, snapshot_date)
);
GRANT SELECT ON public.book_valuation_snapshots TO anon, authenticated;
GRANT ALL ON public.book_valuation_snapshots TO service_role;
ALTER TABLE public.book_valuation_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view valuation snapshots" ON public.book_valuation_snapshots FOR SELECT USING (true);
CREATE INDEX idx_bvs_book_date ON public.book_valuation_snapshots(book_id, snapshot_date DESC);

-- ---- Retire old skill, register new ----
DELETE FROM public.pipeline_skills WHERE skill_key IN ('rights_exchange_model');

INSERT INTO public.pipeline_skills(skill_key, source, version, content_md, metadata)
VALUES ('royalty_ownership_model', 'learned', 3,
$md$# Royalty Ownership — Phase 1 (Buy-Only, Simulated)

## Product concept
Users purchase Royalty Units connected to individual SecretPDF books. Each book has exactly 1,000,000 Royalty Units. Holders receive a lifetime proportional share of the book's distributable royalty revenue.

ownership_percentage = units_owned / 1,000,000 * 100

## Vocabulary
Use: Royalty Units, Royalty Ownership, Lifetime Revenue Share, Historical Book Sales, Estimated Break-Even, Distributable Royalty, Indicative Royalty Unit Value.
Never use: stock, securities, guaranteed investment/return/profit, passive income guarantee.

## Constants (admin-editable per book)
- total_units = 1,000,000
- initial_book_value_usd = 1000  →  initial_unit_price = $0.001
- royalty_pool_percent = 0.50 (default)
- minimum_purchase_usd = 20
- thai_vat_rate = 0.07
- gateway_fee_rate = 0.05
- valuation_multiple = 3.0
- max_daily_value_change = 0.10

## Purchase math (server-side only)
subtotal = units * current_unit_price
vat = subtotal * thai_vat_rate
gateway_fee = (subtotal + vat) * gateway_fee_rate
total_payment = subtotal + vat + gateway_fee

Reference: $20 subtotal -> 20,000 units at $0.001, VAT $1.40, gateway $1.07, total $22.47, ownership 2%.

## Per-sale royalty
sale_vat = gross * sales_vat_rate
sale_gateway_fee = (gross + sale_vat) * sales_gateway_fee_rate
net_sale_revenue = gross - vat - gateway_fee - refunds - chargebacks
distributable_royalty_per_sale = net * royalty_pool_percent
user_royalty_per_sale = distributable * ownership_percentage

## Break-even
break_even_sales_subtotal = ceil(subtotal / user_royalty_per_sale)
break_even_sales_total    = ceil(total_payment / user_royalty_per_sale)

## Indicative valuation (once per day, clamped)
performance_value = max(initial_book_value, trailing_90d_net_sales * valuation_multiple)
indicative_book_value = performance_value * quality_adj * growth_adj * refund_adj
indicative_unit_value = indicative_book_value / 1,000,000
Adjustments bounded: quality 0.80-1.20, growth 0.80-1.50, refund 0.70-1.00.
Daily change clamped to +/- max_daily_value_change.

## Phase limitations
- No resale, no user-to-user transfer, no order book, no withdrawals.
- No real payment gateway: Reserve button creates a quote only ("Payment activation coming soon").
- Only admins may mark a quote `simulated_completed` to create an ownership row.

## Mandatory disclaimers
- Royalty payments depend on actual future book sales and are not guaranteed. Historical performance does not guarantee future results.
- Indicative Royalty Unit Value is an internal estimate; it is not a guaranteed resale value.
- Resale is not available in the current phase.
- Tax and fee amounts are estimates until the payment provider is configured.
- Not financial advice.$md$,
  jsonb_build_object(
    'total_units', 1000000,
    'initial_book_value_usd', 1000,
    'initial_unit_price_usd', 0.001,
    'royalty_pool_percent_default', 0.50,
    'minimum_purchase_usd', 20,
    'thai_vat_rate', 0.07,
    'gateway_fee_rate', 0.05,
    'valuation_multiple_default', 3.0,
    'max_daily_value_change', 0.10,
    'phase', 'buy_only_simulated'
  )
);
