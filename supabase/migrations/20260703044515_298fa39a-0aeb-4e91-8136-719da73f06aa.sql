
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS shopify_title text,
  ADD COLUMN IF NOT EXISTS shopify_subtitle text,
  ADD COLUMN IF NOT EXISTS short_hook text,
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS benefit_bullets jsonb,
  ADD COLUMN IF NOT EXISTS whats_inside jsonb,
  ADD COLUMN IF NOT EXISTS who_its_for jsonb,
  ADD COLUMN IF NOT EXISTS who_its_not_for jsonb,
  ADD COLUMN IF NOT EXISTS compare_at_price numeric,
  ADD COLUMN IF NOT EXISTS price_tier text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS url_slug text,
  ADD COLUMN IF NOT EXISTS pricing_confidence_score integer,
  ADD COLUMN IF NOT EXISTS product_page_qc_score integer,
  ADD COLUMN IF NOT EXISTS thumbnail_qc_score integer,
  ADD COLUMN IF NOT EXISTS shopify_draft_url text,
  ADD COLUMN IF NOT EXISTS shopify_package_json jsonb;
