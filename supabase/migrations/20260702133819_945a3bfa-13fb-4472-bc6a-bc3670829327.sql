
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS inside_illustration_plan_json jsonb,
  ADD COLUMN IF NOT EXISTS inside_illustrations_json jsonb,
  ADD COLUMN IF NOT EXISTS visual_fatigue_score int,
  ADD COLUMN IF NOT EXISTS inside_illustration_relevance_score int,
  ADD COLUMN IF NOT EXISTS text_density_score int,
  ADD COLUMN IF NOT EXISTS worksheet_table_overflow_score int,
  ADD COLUMN IF NOT EXISTS worksheet_readability_score int,
  ADD COLUMN IF NOT EXISTS compliance_rewrites_json jsonb;
