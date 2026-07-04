ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS store_thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS store_thumbnail_qc JSONB,
  ADD COLUMN IF NOT EXISTS store_thumbnail_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thumbnail_needs_review BOOLEAN NOT NULL DEFAULT false;