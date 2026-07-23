-- Reset Bubbly Ocean Buddies to pdf stage so PDF rebuild uses the new illustrated cover.
UPDATE public.coloring_v2_books
   SET stage = 'pdf',
       generation_status = 'running',
       stage_updated_at = now(),
       stage_attempt_count = 0,
       last_error = NULL
 WHERE id = '6133ac75-44c1-4757-bb82-16a6f7c4d967';