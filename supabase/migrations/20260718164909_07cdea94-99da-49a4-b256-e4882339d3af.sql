UPDATE public.autopilot_kids_runs
   SET status = 'completed', updated_at = now()
 WHERE status = 'running'
   AND ebook_kids_id IN (
     SELECT id FROM public.ebooks_kids
      WHERE pipeline_status IN ('retired','shelved','archived_legacy')
   );