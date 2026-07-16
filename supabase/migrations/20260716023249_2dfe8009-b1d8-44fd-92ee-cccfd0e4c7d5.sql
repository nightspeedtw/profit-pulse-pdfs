UPDATE public.generation_settings
   SET coloring_autopilot = coalesce(coloring_autopilot, '{}'::jsonb)
     || jsonb_build_object(
       'paused', coalesce(coloring_autopilot->'paused', 'false'::jsonb),
       'max_parallel', coalesce(coloring_autopilot->'max_parallel', '1'::jsonb),
       'daily_cost_cap_usd_coloring', coalesce(coloring_autopilot->'daily_cost_cap_usd_coloring', '5'::jsonb),
       'last_worker_tick_at', coloring_autopilot->'last_worker_tick_at',
       'last_worker_tick_result', coloring_autopilot->'last_worker_tick_result'
     )
 WHERE id = 1;

CREATE INDEX IF NOT EXISTS ebooks_kids_coloring_queue_idx
  ON public.ebooks_kids (pipeline_status, created_at)
  WHERE book_type = 'coloring_book';