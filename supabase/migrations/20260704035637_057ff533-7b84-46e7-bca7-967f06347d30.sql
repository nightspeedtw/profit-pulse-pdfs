
ALTER TABLE public.generation_settings
  ADD COLUMN IF NOT EXISTS daily_cost_cap_usd numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS max_books_per_day integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_parallel_books integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_parallel_heavy_jobs integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS minimum_qc_pass_rate numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS pause_when_cost_limit_reached boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pause_when_qc_pass_rate_low boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_categories_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS safe_publish_to_store boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quality_first_mode boolean NOT NULL DEFAULT true;
