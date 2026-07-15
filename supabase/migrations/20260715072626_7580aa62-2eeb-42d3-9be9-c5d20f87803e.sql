
ALTER TABLE public.autopilot_kids_runs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS autopilot_kids_runs_archived_idx
  ON public.autopilot_kids_runs (archived_at);
