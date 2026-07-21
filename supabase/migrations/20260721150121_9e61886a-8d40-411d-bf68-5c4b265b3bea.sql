
-- 1. Internal financial ledgers: admin-only reads
DROP POLICY IF EXISTS "Anyone can view sales ledger" ON public.book_sales_ledger;
CREATE POLICY "Admins can view sales ledger"
  ON public.book_sales_ledger FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone can view valuation snapshots" ON public.book_valuation_snapshots;
CREATE POLICY "Admins can view valuation snapshots"
  ON public.book_valuation_snapshots FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Royalty rights exchange (decommissioned): admin-only
DROP POLICY IF EXISTS "Anyone can view royalty markets" ON public.book_royalty_markets;
CREATE POLICY "Admins can view royalty markets"
  ON public.book_royalty_markets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public read offerings" ON public.rights_offerings;
CREATE POLICY "Admins read offerings" ON public.rights_offerings FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public read orders" ON public.rights_orders;
CREATE POLICY "Admins read orders" ON public.rights_orders FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public read price history" ON public.rights_price_history;
CREATE POLICY "Admins read price history" ON public.rights_price_history FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public read trades" ON public.rights_trades;
CREATE POLICY "Admins read trades" ON public.rights_trades FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

REVOKE SELECT ON public.book_sales_ledger, public.book_valuation_snapshots,
                 public.book_royalty_markets, public.rights_offerings,
                 public.rights_orders, public.rights_price_history,
                 public.rights_trades
  FROM anon;

-- 3. AI pipeline configuration: authenticated only
DROP POLICY IF EXISTS "pipeline_skills readable" ON public.pipeline_skills;
CREATE POLICY "pipeline_skills readable auth"
  ON public.pipeline_skills FOR SELECT
  TO authenticated USING (true);
REVOKE SELECT ON public.pipeline_skills FROM anon;

DROP POLICY IF EXISTS "runtime_skill_contracts readable" ON public.runtime_skill_contracts;
CREATE POLICY "runtime_skill_contracts readable auth"
  ON public.runtime_skill_contracts FOR SELECT
  TO authenticated USING (true);
REVOKE SELECT ON public.runtime_skill_contracts FROM anon;

-- 4. platform_settings: admin-only reads, except a whitelist of storefront keys.
DROP POLICY IF EXISTS "public read platform settings" ON public.platform_settings;
CREATE POLICY "Public read whitelisted platform_settings"
  ON public.platform_settings FOR SELECT
  TO anon, authenticated
  USING (key IN (
    'storefront_sale_config',
    'ENABLE_COLORING_LANE_V2',
    'bundle_discount_pct',
    'marketing_autopilot_v2_enabled',
    'autopilot_frozen'
  ));
CREATE POLICY "Admins read all platform_settings"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. product_pricing: hide internal pricing metrics from the public.
REVOKE SELECT (value_score, confidence, value_tier, last_evaluator_run_at, rule_version)
  ON public.product_pricing FROM anon, authenticated;

-- 6. coloring_book_events: light per-IP rate limit + validation on public inserts.
CREATE OR REPLACE FUNCTION public.coloring_book_events_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent int;
BEGIN
  IF NEW.event_type IS NULL OR length(NEW.event_type) > 64 THEN
    RAISE EXCEPTION 'invalid event_type';
  END IF;
  IF NEW.event_type !~ '^[a-z0-9_.-]+$' THEN
    RAISE EXCEPTION 'invalid event_type format';
  END IF;
  -- Very light rate limit: cap identical (ebook, event_type) inserts to 60/min.
  SELECT count(*) INTO v_recent
    FROM public.coloring_book_events
   WHERE ebook_kids_id IS NOT DISTINCT FROM NEW.ebook_kids_id
     AND event_type = NEW.event_type
     AND created_at > now() - interval '1 minute';
  IF v_recent >= 60 THEN
    RAISE EXCEPTION 'rate limit exceeded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coloring_book_events_validate_ins ON public.coloring_book_events;
CREATE TRIGGER coloring_book_events_validate_ins
  BEFORE INSERT ON public.coloring_book_events
  FOR EACH ROW EXECUTE FUNCTION public.coloring_book_events_validate();

-- 7. Revoke EXECUTE from anon on internal SECURITY DEFINER helpers.
REVOKE EXECUTE ON FUNCTION public.atomic_patch_ebooks_kids_meta(uuid, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.coloring_v2_advance_stage(uuid, text, text, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.coloring_v2_record_error(uuid, text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_compare_at_price_legitimate(text, uuid, text, integer, timestamptz, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.kids_cycle_stats(integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.roy_available_cents(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.coloring_book_events_validate() FROM anon, authenticated, public;
