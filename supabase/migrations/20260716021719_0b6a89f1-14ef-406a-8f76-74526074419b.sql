ALTER TABLE public.generation_settings
  ADD COLUMN IF NOT EXISTS coloring_autopilot jsonb NOT NULL DEFAULT jsonb_build_object(
    'enabled', false,
    'topic_mode', 'random',
    'specific_category_key', null,
    'age_band', '4-6',
    'page_count', 32,
    'batch_size', 1,
    'daily_cap', 3,
    'daily_stop_utc', '22:00'
  );