UPDATE public.generation_settings
SET daily_budget_usd = 300,
    daily_cost_cap_usd = 300,
    paused = false,
    cost_limit_reached = false,
    cost_limit_reached_at = NULL,
    cost_limit_reason = NULL
WHERE id = 1;

UPDATE public.ebooks_kids
SET pipeline_status = 'queued',
    blocker_reason = NULL,
    next_retry_at = NULL
WHERE book_type = 'coloring_book'
  AND pipeline_status IN ('awaiting_quota_reset','awaiting_owner')
  AND (blocker_reason ILIKE '%cloudflare%'
       OR blocker_reason ILIKE '%coloring_cover_retry_ceiling%'
       OR blocker_reason ILIKE '%coloring_cover_verify_fatal%');