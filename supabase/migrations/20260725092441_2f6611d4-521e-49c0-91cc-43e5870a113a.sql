UPDATE public.coloring_v2_books
SET stage = 'interior_render',
    generation_status = 'running',
    stage_attempt_count = 0,
    last_error = NULL,
    stage_updated_at = now(),
    updated_at = now()
WHERE id = 'abce4e6d-6de2-4ab3-a8b2-eafa370e279b'::uuid
  AND last_error LIKE 'needs_code_fix:render_page_out_of_range:%';