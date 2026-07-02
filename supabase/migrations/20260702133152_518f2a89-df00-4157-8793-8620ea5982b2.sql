
ALTER TABLE public.autopilot_pipeline_runs
  ADD COLUMN IF NOT EXISTS current_subtask text,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
