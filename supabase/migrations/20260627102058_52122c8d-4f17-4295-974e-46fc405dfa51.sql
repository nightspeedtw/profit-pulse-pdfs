
ALTER TABLE public.generation_settings
  ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopilot_mode text NOT NULL DEFAULT 'safe',
  ADD COLUMN IF NOT EXISTS publish_hour_utc int NOT NULL DEFAULT 14;
