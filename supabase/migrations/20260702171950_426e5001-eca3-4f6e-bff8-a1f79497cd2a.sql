-- Permanent fix: only ONE active pipeline run per ebook.

-- Phase 1: cleanup existing dupes (keep newest active run per ebook).
WITH ranked AS (
  SELECT id,
         ebook_id,
         ROW_NUMBER() OVER (
           PARTITION BY ebook_id
           ORDER BY updated_at DESC NULLS LAST, started_at DESC NULLS LAST
         ) AS rn
  FROM public.autopilot_pipeline_runs
  WHERE ebook_id IS NOT NULL
    AND status IN ('running', 'queued', 'starting')
)
UPDATE public.autopilot_pipeline_runs r
SET status = 'superseded',
    completed_at = COALESCE(r.completed_at, now()),
    current_action_message = 'Superseded by newer run for this ebook',
    updated_at = now()
FROM ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

-- Cancel any active runs whose ebook is already terminal.
UPDATE public.autopilot_pipeline_runs r
SET status = 'superseded',
    completed_at = COALESCE(r.completed_at, now()),
    current_action_message = 'Superseded: ebook already in terminal state',
    updated_at = now()
FROM public.ebooks e
WHERE r.ebook_id = e.id
  AND r.status IN ('running', 'queued', 'starting')
  AND e.canonical_status IN (
    'shopify_uploaded', 'published', 'ready_to_publish',
    'failed_permanent', 'archived'
  );

-- Phase 2: enforce ONE active run per ebook forever.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_ebook
  ON public.autopilot_pipeline_runs (ebook_id)
  WHERE ebook_id IS NOT NULL
    AND status IN ('running', 'queued', 'starting');

-- Defensive: one chapter row per (ebook_id, chapter_index).
CREATE UNIQUE INDEX IF NOT EXISTS one_chapter_per_index
  ON public.ebook_chapters (ebook_id, chapter_index);

-- Phase 3: release stale Sequential-Safe-Mode locks.
UPDATE public.production_locks
SET holder_ebook_id = NULL,
    holder_run_id = NULL,
    acquired_at = NULL,
    expires_at = NULL
WHERE expires_at IS NOT NULL
  AND expires_at < now();