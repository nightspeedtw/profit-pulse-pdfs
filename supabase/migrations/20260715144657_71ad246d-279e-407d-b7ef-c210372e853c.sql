ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS internal_story_brief_json JSONB,
  ADD COLUMN IF NOT EXISTS customer_product_description_html TEXT,
  ADD COLUMN IF NOT EXISTS sales_copy_sanitized_at TIMESTAMPTZ;
COMMENT ON COLUMN public.ebooks_kids.internal_story_brief_json IS 'Phase 8: PRIVATE story brief / craft notes. NEVER render on storefront. Server code must not select this for anonymous callers.';
COMMENT ON COLUMN public.ebooks_kids.customer_product_description_html IS 'Phase 8: PUBLIC sanitized HTML for the storefront sales page. Populated only via the sanitizer; must contain zero internal-note leakage.';
COMMENT ON COLUMN public.ebooks_kids.sales_copy_sanitized_at IS 'Phase 8: timestamp the sanitizer last produced customer_product_description_html.';