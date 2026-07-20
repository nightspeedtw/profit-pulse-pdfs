UPDATE public.coloring_v2_books
   SET last_error = NULL, stage_attempt_count = 0, updated_at = now()
 WHERE stage = 'cover'
   AND (last_error ILIKE '%cover_ocr_hard_reject%' OR last_error ILIKE '%transcriber_unavailable%');