ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS shopify_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS shopify_last_error text,
  ADD COLUMN IF NOT EXISTS shopify_last_event_at timestamptz;