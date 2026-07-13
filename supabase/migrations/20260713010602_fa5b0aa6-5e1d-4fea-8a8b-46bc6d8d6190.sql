ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS kids_visual_bible jsonb,
  ADD COLUMN IF NOT EXISTS kids_scene_briefs_json jsonb;