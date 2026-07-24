UPDATE public.coloring_v2_books
SET stage = 'interior_render',
    generation_status = 'queued',
    stage_attempt_count = 0,
    last_error = NULL,
    stage_updated_at = now(),
    updated_at = now()
WHERE stage = 'failed'
  AND last_error LIKE 'anatomy_unrecoverable_page_%unrecognizable_subject%';