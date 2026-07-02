
-- P1: Fix visibility. Add missing progress columns on ebooks so RunTracker.syncEbook() lands.
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS current_step_label text,
  ADD COLUMN IF NOT EXISTS current_action_message text,
  ADD COLUMN IF NOT EXISTS progress_percent integer,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocker_reason text;

-- Backfill canonical_status + current_step from the newest live run per ebook.
UPDATE public.ebooks e
SET
  canonical_status = COALESCE(
    e.canonical_status,
    CASE
      WHEN r.status = 'completed' THEN 'completed'
      WHEN r.status = 'failed' THEN 'needs_admin'
      WHEN r.status = 'superseded' THEN e.canonical_status
      WHEN e.autopilot_state = 'waiting_for_shopify_quota' THEN 'waiting_for_shopify_quota'
      WHEN e.autopilot_state = 'waiting_for_browserless_slot' THEN 'waiting_for_browserless_slot'
      WHEN e.autopilot_state = 'queued_for_production' THEN 'queued'
      WHEN e.autopilot_state = 'production_running' THEN 'production_running'
      WHEN e.autopilot_state = 'done' THEN 'completed'
      WHEN e.autopilot_state = 'failed' THEN 'needs_admin'
      WHEN e.autopilot_state = 'needs_review' THEN 'needs_admin'
      ELSE 'idle'
    END
  ),
  current_step = COALESCE(e.current_step, r.current_step),
  current_step_label = COALESCE(e.current_step_label, r.current_step_label),
  current_action_message = COALESCE(e.current_action_message, r.current_action_message),
  progress_percent = COALESCE(e.progress_percent, r.progress_percent)
FROM (
  SELECT DISTINCT ON (ebook_id) ebook_id, status, current_step, current_step_label,
    current_action_message, progress_percent, updated_at
  FROM public.autopilot_pipeline_runs
  WHERE ebook_id IS NOT NULL
  ORDER BY ebook_id, updated_at DESC
) r
WHERE r.ebook_id = e.id;

-- For ebooks with no run rows at all, at least stamp a canonical status from autopilot_state.
UPDATE public.ebooks
SET canonical_status = CASE
    WHEN autopilot_state = 'done' THEN 'completed'
    WHEN autopilot_state = 'production_running' THEN 'production_running'
    WHEN autopilot_state = 'queued_for_production' THEN 'queued'
    WHEN autopilot_state = 'waiting_for_shopify_quota' THEN 'waiting_for_shopify_quota'
    WHEN autopilot_state = 'waiting_for_browserless_slot' THEN 'waiting_for_browserless_slot'
    WHEN autopilot_state = 'failed' THEN 'needs_admin'
    WHEN autopilot_state = 'needs_review' THEN 'needs_admin'
    ELSE 'idle'
  END
WHERE canonical_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_ebooks_canonical_status ON public.ebooks(canonical_status);
