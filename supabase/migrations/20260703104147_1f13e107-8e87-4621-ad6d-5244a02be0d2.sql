
-- Phase 1 Self-Healing Autopilot: canonical model extensions
ALTER TABLE public.autopilot_pipeline_steps
  ADD COLUMN IF NOT EXISTS output_valid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS repair_action text,
  ADD COLUMN IF NOT EXISTS next_step text,
  ADD COLUMN IF NOT EXISTS qc_score numeric;

ALTER TABLE public.autopilot_pipeline_runs
  ADD COLUMN IF NOT EXISTS queue_position integer,
  ADD COLUMN IF NOT EXISTS preflight_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resume_from_step text;

-- Grants (idempotent)
GRANT SELECT, INSERT, UPDATE ON public.autopilot_pipeline_steps TO authenticated;
GRANT ALL ON public.autopilot_pipeline_steps TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.autopilot_pipeline_runs TO authenticated;
GRANT ALL ON public.autopilot_pipeline_runs TO service_role;
