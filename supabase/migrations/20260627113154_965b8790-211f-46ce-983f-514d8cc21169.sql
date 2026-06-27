
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS cover_spec jsonb,
  ADD COLUMN IF NOT EXISTS cover_qc jsonb,
  ADD COLUMN IF NOT EXISTS cover_score integer,
  ADD COLUMN IF NOT EXISTS cover_bg_url text,
  ADD COLUMN IF NOT EXISTS cover_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interior_visuals jsonb;
