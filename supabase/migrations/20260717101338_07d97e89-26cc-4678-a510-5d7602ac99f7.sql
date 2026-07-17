-- Add next_retry_at column for scheduled wake of parked coloring books
-- (states: awaiting_quota_reset, awaiting_billing). Used by coloring-worker-tick.
ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ebooks_kids_awaiting_wake
  ON public.ebooks_kids (pipeline_status, next_retry_at)
  WHERE pipeline_status IN ('awaiting_quota_reset','awaiting_billing');