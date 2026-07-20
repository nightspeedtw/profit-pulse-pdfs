
-- =========================================================================
-- Marketing Autopilot — Phase 1: pricing foundation
-- Separate subsystem from book-generation autopilot. Never touches QC or
-- production pipeline. All writes are service-role only.
-- =========================================================================

-- 1) marketing_settings (singleton) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_settings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton                   boolean NOT NULL DEFAULT true,
  mode                        text NOT NULL DEFAULT 'OFF'
    CHECK (mode IN ('OFF','OBSERVE_ONLY','RECOMMEND_ONLY','AUTO_LOW_RISK','FULL_AUTOPILOT')),
  primary_market              text NOT NULL DEFAULT 'US',
  timezone                    text NOT NULL DEFAULT 'America/New_York',

  -- master + subsystem toggles
  marketing_autopilot_enabled boolean NOT NULL DEFAULT false,
  dynamic_regular_pricing     boolean NOT NULL DEFAULT false,
  seasonal_campaigns          boolean NOT NULL DEFAULT false,
  flash_sales                 boolean NOT NULL DEFAULT false,
  bundle_builder              boolean NOT NULL DEFAULT false,
  onsite_merchandising        boolean NOT NULL DEFAULT false,
  email_automation            boolean NOT NULL DEFAULT false,
  trend_discovery             boolean NOT NULL DEFAULT false,
  experiment_engine           boolean NOT NULL DEFAULT false,
  paid_ads_autopilot          boolean NOT NULL DEFAULT false,
  emergency_stop              boolean NOT NULL DEFAULT false,
  emergency_stop_reason       text,

  -- floors + ceilings (cents)
  min_regular_price_cents        integer NOT NULL DEFAULT 500,
  single_sale_floor_cents        integer NOT NULL DEFAULT 199,
  bundle_per_book_floor_cents    integer NOT NULL DEFAULT 199,
  max_discount_pct               integer NOT NULL DEFAULT 80,

  -- cooldowns (hours)
  regular_price_cooldown_hours   integer NOT NULL DEFAULT 720,   -- 30d
  max_regular_move_pct           integer NOT NULL DEFAULT 5,
  campaign_cooldown_hours        integer NOT NULL DEFAULT 168,   -- 7d
  flash_sale_199_cooldown_hours  integer NOT NULL DEFAULT 2160,  -- 90d
  flash_sale_199_max_duration_h  integer NOT NULL DEFAULT 24,
  full_price_days_pct_90d        integer NOT NULL DEFAULT 60,

  -- experiment thresholds
  min_experiment_days            integer NOT NULL DEFAULT 7,
  min_qualified_sessions         integer NOT NULL DEFAULT 500,
  min_purchases_for_price_conc   integer NOT NULL DEFAULT 30,
  min_confidence_pct             integer NOT NULL DEFAULT 95,
  min_meaningful_lift_pct        integer NOT NULL DEFAULT 5,

  -- ads / roas
  target_revenue_roas_bp         integer,   -- basis points; nullable until verified
  target_profit_roas_bp          integer,
  daily_ad_budget_cap_cents      integer,
  campaign_budget_cap_cents      integer,

  -- audit
  rule_version                integer NOT NULL DEFAULT 1,
  last_planner_run_at         timestamptz,
  last_evaluator_run_at       timestamptz,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
-- exactly one row
CREATE UNIQUE INDEX IF NOT EXISTS marketing_settings_singleton_uidx
  ON public.marketing_settings ((singleton)) WHERE singleton = true;

GRANT SELECT ON public.marketing_settings TO authenticated;
GRANT ALL    ON public.marketing_settings TO service_role;
ALTER TABLE public.marketing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read marketing_settings"
  ON public.marketing_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER marketing_settings_updated_at
  BEFORE UPDATE ON public.marketing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.marketing_settings (mode) VALUES ('OFF')
  ON CONFLICT DO NOTHING;

-- 2) product_pricing (authoritative per-SKU price state) ---------------------
CREATE TABLE IF NOT EXISTS public.product_pricing (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_kind             text NOT NULL DEFAULT 'ebook_kids'
    CHECK (product_kind IN ('ebook_kids','ebook','bundle','coloring_v2')),
  product_id               uuid NOT NULL,
  market                   text NOT NULL DEFAULT 'US',

  regular_price_cents      integer NOT NULL CHECK (regular_price_cents >= 500),
  campaign_price_cents     integer,
  effective_price_cents    integer NOT NULL,
  currency                 text NOT NULL DEFAULT 'USD',

  value_tier               text,
  value_score              numeric(6,2),
  confidence               numeric(4,2),

  active_campaign_id       uuid,
  campaign_valid_from      timestamptz,
  campaign_valid_to        timestamptz,
  locked_until             timestamptz,   -- server-side checkout price lock
  regular_locked_until     timestamptz,   -- 30d cooldown expiry for regular changes

  rule_version             integer NOT NULL DEFAULT 1,
  last_regular_change_at   timestamptz,
  last_evaluator_run_at    timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (product_kind, product_id, market)
);

CREATE INDEX IF NOT EXISTS product_pricing_active_campaign_idx
  ON public.product_pricing (active_campaign_id) WHERE active_campaign_id IS NOT NULL;

GRANT SELECT ON public.product_pricing TO authenticated, anon;
GRANT ALL    ON public.product_pricing TO service_role;
ALTER TABLE public.product_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read product_pricing"
  ON public.product_pricing FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TRIGGER product_pricing_updated_at
  BEFORE UPDATE ON public.product_pricing
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) price_history (append-only ledger) --------------------------------------
CREATE TABLE IF NOT EXISTS public.price_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_kind             text NOT NULL,
  product_id               uuid NOT NULL,
  market                   text NOT NULL DEFAULT 'US',

  price_type               text NOT NULL
    CHECK (price_type IN ('regular','campaign','experiment','rollback','init')),
  previous_price_cents     integer,
  new_price_cents          integer NOT NULL,
  currency                 text NOT NULL DEFAULT 'USD',

  reason                   text,
  campaign_id              uuid,
  experiment_id            uuid,
  ai_decision_id           uuid,
  rollback_ref             uuid,
  metric_snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,

  effective_from           timestamptz NOT NULL DEFAULT now(),
  effective_to             timestamptz,
  rule_version             integer NOT NULL DEFAULT 1,

  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_history_product_idx
  ON public.price_history (product_kind, product_id, market, effective_from DESC);
CREATE INDEX IF NOT EXISTS price_history_campaign_idx
  ON public.price_history (campaign_id) WHERE campaign_id IS NOT NULL;

GRANT SELECT ON public.price_history TO authenticated;
GRANT ALL    ON public.price_history TO service_role;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read price_history"
  ON public.price_history FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) Compare-at legitimacy check ---------------------------------------------
-- Returns true only if the given compare-at cents has real, publicly-active
-- regular-price history for the required window and the current effective is
-- strictly cheaper. Never trusts client-supplied compare-at.
CREATE OR REPLACE FUNCTION public.is_compare_at_price_legitimate(
  p_product_kind      text,
  p_product_id        uuid,
  p_market            text,
  p_compare_at_cents  integer,
  p_campaign_start_at timestamptz,
  p_min_days          integer DEFAULT 30
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_effective integer;
  v_days      integer;
BEGIN
  IF p_compare_at_cents IS NULL OR p_compare_at_cents <= 0 THEN RETURN false; END IF;
  IF p_campaign_start_at IS NULL THEN RETURN false; END IF;

  SELECT effective_price_cents INTO v_effective
    FROM public.product_pricing
   WHERE product_kind = p_product_kind AND product_id = p_product_id AND market = p_market;
  IF v_effective IS NULL OR p_compare_at_cents <= v_effective THEN RETURN false; END IF;

  -- Count distinct days where a regular-price record was effective and equal
  -- to the compare-at value, ending strictly before campaign start.
  SELECT COUNT(DISTINCT date_trunc('day', gs))::int INTO v_days
    FROM public.price_history ph,
         LATERAL generate_series(
           GREATEST(ph.effective_from, p_campaign_start_at - make_interval(days => p_min_days * 3)),
           LEAST(COALESCE(ph.effective_to, p_campaign_start_at), p_campaign_start_at),
           interval '1 day'
         ) AS gs
   WHERE ph.product_kind = p_product_kind
     AND ph.product_id   = p_product_id
     AND ph.market       = p_market
     AND ph.price_type   = 'regular'
     AND ph.new_price_cents = p_compare_at_cents
     AND ph.effective_from < p_campaign_start_at;

  RETURN COALESCE(v_days, 0) >= p_min_days;
END;
$$;

REVOKE ALL ON FUNCTION public.is_compare_at_price_legitimate(text,uuid,text,integer,timestamptz,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.is_compare_at_price_legitimate(text,uuid,text,integer,timestamptz,integer)
  TO authenticated, service_role;

-- 5) Backfill product_pricing from ebooks_kids -------------------------------
INSERT INTO public.product_pricing (
  product_kind, product_id, market,
  regular_price_cents, campaign_price_cents, effective_price_cents,
  rule_version
)
SELECT
  'ebook_kids'::text,
  ek.id,
  'US'::text,
  GREATEST(500, COALESCE(NULLIF(ek.price_cents, 0), 999))::int,
  NULL,
  GREATEST(500, COALESCE(NULLIF(ek.price_cents, 0), 999))::int,
  1
FROM public.ebooks_kids ek
WHERE ek.id IS NOT NULL
ON CONFLICT (product_kind, product_id, market) DO NOTHING;

-- Seed init history rows so future compare-at checks have a baseline
INSERT INTO public.price_history (
  product_kind, product_id, market,
  price_type, previous_price_cents, new_price_cents,
  reason, effective_from, rule_version
)
SELECT
  pp.product_kind, pp.product_id, pp.market,
  'init'::text, NULL, pp.regular_price_cents,
  'phase1_backfill', pp.created_at, 1
FROM public.product_pricing pp
WHERE NOT EXISTS (
  SELECT 1 FROM public.price_history ph
   WHERE ph.product_kind = pp.product_kind
     AND ph.product_id   = pp.product_id
     AND ph.market       = pp.market
);
