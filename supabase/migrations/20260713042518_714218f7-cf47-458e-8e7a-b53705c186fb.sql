
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS cliffhanger_hook text,
  ADD COLUMN IF NOT EXISTS preview_page_count integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS hook_description text;
