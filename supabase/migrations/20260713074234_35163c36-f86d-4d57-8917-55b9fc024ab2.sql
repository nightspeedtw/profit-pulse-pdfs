
ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS preview_page_urls jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS interior_illustrations jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS style_bible_json jsonb;
