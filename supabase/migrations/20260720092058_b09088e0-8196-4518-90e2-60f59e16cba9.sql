INSERT INTO public.platform_settings (key, value_json)
VALUES ('marketing_autopilot_v2_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('seasonal','flash','evergreen')),
  season_key TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','live','ended','cancelled')),
  discount_pct INTEGER NOT NULL CHECK (discount_pct BETWEEN 5 AND 40),
  min_price_floor_cents INTEGER NOT NULL DEFAULT 500,
  audience_age_bands TEXT[] NOT NULL DEFAULT '{}',
  audience_book_types TEXT[] NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  auto_generated BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  CHECK (ends_at > starts_at)
);
GRANT SELECT ON public.campaigns TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_public_read_live" ON public.campaigns FOR SELECT USING (status = 'live');
CREATE POLICY "campaigns_admin_read_all" ON public.campaigns FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "campaigns_admin_write" ON public.campaigns FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS campaigns_status_window_idx ON public.campaigns (status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS campaigns_season_idx ON public.campaigns (season_key);
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  product_kind TEXT NOT NULL,
  product_id UUID NOT NULL,
  market TEXT NOT NULL DEFAULT 'us',
  compare_at_cents INTEGER,
  campaign_price_cents INTEGER NOT NULL,
  compare_at_valid BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, product_kind, product_id, market),
  CHECK (campaign_price_cents >= 500)
);
GRANT SELECT ON public.campaign_products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_products TO authenticated;
GRANT ALL ON public.campaign_products TO service_role;
ALTER TABLE public.campaign_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_products_public_read_live" ON public.campaign_products FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_products.campaign_id AND c.status = 'live'));
CREATE POLICY "campaign_products_admin_read_all" ON public.campaign_products FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "campaign_products_admin_write" ON public.campaign_products FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS campaign_products_product_idx ON public.campaign_products (product_kind, product_id, market);
CREATE TRIGGER campaign_products_set_updated_at BEFORE UPDATE ON public.campaign_products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.seasonal_calendar_seed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  rule_kind TEXT NOT NULL CHECK (rule_kind IN ('fixed_date','us_holiday')),
  anchor_month INTEGER CHECK (anchor_month BETWEEN 1 AND 12),
  anchor_day INTEGER CHECK (anchor_day BETWEEN 1 AND 31),
  us_holiday_tag TEXT,
  lead_days INTEGER NOT NULL DEFAULT 14,
  duration_days INTEGER NOT NULL DEFAULT 7,
  default_discount_pct INTEGER NOT NULL DEFAULT 15 CHECK (default_discount_pct BETWEEN 5 AND 40),
  audience_age_bands TEXT[] NOT NULL DEFAULT '{}',
  audience_book_types TEXT[] NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.seasonal_calendar_seed TO anon, authenticated;
GRANT ALL ON public.seasonal_calendar_seed TO service_role;
ALTER TABLE public.seasonal_calendar_seed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasonal_calendar_seed_public_read" ON public.seasonal_calendar_seed FOR SELECT USING (true);
CREATE POLICY "seasonal_calendar_seed_admin_write" ON public.seasonal_calendar_seed FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER seasonal_calendar_seed_set_updated_at BEFORE UPDATE ON public.seasonal_calendar_seed FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.seasonal_calendar_seed
  (season_key, display_name, rule_kind, anchor_month, anchor_day, us_holiday_tag, lead_days, duration_days, default_discount_pct, priority)
VALUES
  ('valentines',     'Valentine''s Day', 'fixed_date', 2, 14, NULL, 10, 4, 15, 60),
  ('easter',         'Easter',           'us_holiday', NULL, NULL, 'easter_us', 14, 7, 15, 70),
  ('mothers_day',    'Mother''s Day',    'us_holiday', NULL, NULL, 'mothers_day_us', 14, 5, 15, 65),
  ('fathers_day',    'Father''s Day',    'us_holiday', NULL, NULL, 'fathers_day_us', 14, 5, 15, 65),
  ('summer_break',   'Summer Break',     'fixed_date', 6, 15, NULL, 7, 30, 10, 80),
  ('back_to_school', 'Back to School',   'fixed_date', 8, 1,  NULL, 14, 21, 20, 40),
  ('halloween',      'Halloween',        'fixed_date', 10, 31, NULL, 21, 10, 20, 50),
  ('thanksgiving',   'Thanksgiving',     'us_holiday', NULL, NULL, 'thanksgiving_us', 7, 5, 15, 45),
  ('black_friday',   'Black Friday',     'us_holiday', NULL, NULL, 'black_friday_us', 3, 5, 30, 10),
  ('cyber_monday',   'Cyber Monday',     'us_holiday', NULL, NULL, 'cyber_monday_us', 1, 2, 30, 15),
  ('christmas',      'Christmas',        'fixed_date', 12, 25, NULL, 21, 10, 25, 20)
ON CONFLICT (season_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  age_band TEXT NOT NULL,
  theme TEXT,
  member_kind TEXT NOT NULL DEFAULT 'ebook_kids',
  member_ids UUID[] NOT NULL,
  member_count INTEGER GENERATED ALWAYS AS (array_length(member_ids, 1)) STORED,
  bundle_price_cents INTEGER NOT NULL,
  members_total_cents INTEGER NOT NULL,
  savings_cents INTEGER NOT NULL,
  savings_pct NUMERIC(5,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','retired')),
  cover_urls JSONB NOT NULL DEFAULT '[]',
  composition_hash TEXT NOT NULL,
  auto_generated BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  CHECK (bundle_price_cents >= 500),
  CHECK (member_ids IS NOT NULL AND array_length(member_ids, 1) BETWEEN 2 AND 5)
);
GRANT SELECT ON public.bundles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bundles TO authenticated;
GRANT ALL ON public.bundles TO service_role;
ALTER TABLE public.bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bundles_public_read_live" ON public.bundles FOR SELECT USING (status = 'live');
CREATE POLICY "bundles_admin_read_all" ON public.bundles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "bundles_admin_write" ON public.bundles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS bundles_active_composition_uniq ON public.bundles (composition_hash) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS bundles_age_band_idx ON public.bundles (age_band, status);
CREATE TRIGGER bundles_set_updated_at BEFORE UPDATE ON public.bundles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.bundle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID REFERENCES public.bundles(id) ON DELETE SET NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('assembled','published','retired','failed','skipped')),
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bundle_events TO authenticated;
GRANT ALL ON public.bundle_events TO service_role;
ALTER TABLE public.bundle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bundle_events_admin_only" ON public.bundle_events FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS bundle_events_bundle_idx ON public.bundle_events (bundle_id, created_at DESC);