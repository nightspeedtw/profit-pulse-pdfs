-- Clear legacy p0 hold + failed blocker on existing coloring queue rows so
-- the new format-agnostic verify-at-birth path can retry cleanly.
UPDATE public.ebooks_kids
   SET blocker_reason = NULL,
       metadata = (metadata - 'awaiting' - 'coloring_last_errors')
             || jsonb_build_object('coloring_current_step_label', 'Queued — re-dispatch after image-kind fix',
                                    'coloring_progress_percent', 5)
 WHERE book_type = 'coloring_book'
   AND pipeline_status = 'queued';