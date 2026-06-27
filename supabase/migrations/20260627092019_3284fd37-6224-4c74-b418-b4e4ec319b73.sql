
ALTER TABLE public.ebook_ideas
  ADD COLUMN IF NOT EXISTS raw_title text,
  ADD COLUMN IF NOT EXISTS raw_subtitle text,
  ADD COLUMN IF NOT EXISTS raw_hook text,
  ADD COLUMN IF NOT EXISTS raw_target_buyer text,
  ADD COLUMN IF NOT EXISTS core_pain_point text,
  ADD COLUMN IF NOT EXISTS deeper_emotional_fear text,
  ADD COLUMN IF NOT EXISTS transformation_promise text,
  ADD COLUMN IF NOT EXISTS perceived_value_boosters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS why_it_sells text,
  ADD COLUMN IF NOT EXISTS recommended_action text,
  ADD COLUMN IF NOT EXISTS improvement_round integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_feedback text;
