ALTER TABLE public.ebooks_kids ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_ebooks_kids_metadata_gin ON public.ebooks_kids USING gin (metadata);