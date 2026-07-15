
ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS story_bible_id UUID,
  ADD COLUMN IF NOT EXISTS character_bible_id UUID,
  ADD COLUMN IF NOT EXISTS character_reference_id UUID,
  ADD COLUMN IF NOT EXISTS style_version TEXT;

COMMENT ON COLUMN public.ebooks_kids.story_bible_id IS 'Canonical Story Bible reference ID. Required lock for generate_cover/generate_interior/final_release.';
COMMENT ON COLUMN public.ebooks_kids.character_bible_id IS 'Canonical Character Bible reference ID. Required lock for cover/interior/release.';
COMMENT ON COLUMN public.ebooks_kids.character_reference_id IS 'Canonical Character Reference Sheet asset ID passed to every image generator.';
COMMENT ON COLUMN public.ebooks_kids.style_version IS 'Locked illustration style version string; must be identical for cover and every interior page.';
