
-- Drop Shopify-only tables entirely
DROP TABLE IF EXISTS public.shopify_sync_logs CASCADE;
DROP TABLE IF EXISTS public.shopify_upload_queue CASCADE;

-- Rename fields that still carry meaning as storefront metadata
ALTER TABLE public.ebooks RENAME COLUMN shopify_title TO storefront_title;
ALTER TABLE public.ebooks RENAME COLUMN shopify_subtitle TO storefront_subtitle;
ALTER TABLE public.ebook_ideas RENAME COLUMN shopify_meta TO storefront_meta;

-- Drop unused Shopify-specific columns on ebooks
ALTER TABLE public.ebooks
  DROP COLUMN IF EXISTS shopify_draft_url,
  DROP COLUMN IF EXISTS shopify_events,
  DROP COLUMN IF EXISTS shopify_handle,
  DROP COLUMN IF EXISTS shopify_last_error,
  DROP COLUMN IF EXISTS shopify_last_event_at,
  DROP COLUMN IF EXISTS shopify_package_json,
  DROP COLUMN IF EXISTS shopify_product_id,
  DROP COLUMN IF EXISTS shopify_status,
  DROP COLUMN IF EXISTS qc_ready_for_shopify;

-- Drop Shopify-specific columns on generation_settings
ALTER TABLE public.generation_settings
  DROP COLUMN IF EXISTS max_shopify_uploads_per_day,
  DROP COLUMN IF EXISTS shopify_draft_upload_enabled,
  DROP COLUMN IF EXISTS shopify_upload_concurrency;
