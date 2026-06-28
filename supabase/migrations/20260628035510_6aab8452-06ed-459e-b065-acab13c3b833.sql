ALTER TABLE public.shopify_sync_logs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS file_upload_status TEXT;
