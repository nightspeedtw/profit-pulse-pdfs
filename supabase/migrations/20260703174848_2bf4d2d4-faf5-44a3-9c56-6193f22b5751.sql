ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS selling_hook text,
  ADD COLUMN IF NOT EXISTS benefit_bullets jsonb;