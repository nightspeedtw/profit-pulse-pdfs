
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS pricing_report jsonb,
  ADD COLUMN IF NOT EXISTS recommended_price numeric,
  ADD COLUMN IF NOT EXISTS launch_price numeric,
  ADD COLUMN IF NOT EXISTS standard_price numeric,
  ADD COLUMN IF NOT EXISTS low_price_test numeric,
  ADD COLUMN IF NOT EXISTS high_price_test numeric,
  ADD COLUMN IF NOT EXISTS bundle_price_recommendation numeric,
  ADD COLUMN IF NOT EXISTS pricing_tier text,
  ADD COLUMN IF NOT EXISTS price_confidence_score integer,
  ADD COLUMN IF NOT EXISTS pricing_computed_at timestamptz;
