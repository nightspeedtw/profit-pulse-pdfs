DELETE FROM public.production_locks WHERE name IN ('pdf_render','heavy_production');
UPDATE public.ebooks
   SET pdf_status = 'idle',
       autopilot_state = 'rendering_pdf',
       canonical_status = 'rendering_pdf',
       blocker_class = NULL,
       blocker_reason = NULL,
       needs_review_reason = NULL,
       waiting_reason = NULL,
       browserless_retry_count = 0
 WHERE id IN (
   '16b3122c-0c38-4dfd-8cb8-d3ca64034350',
   '92bbc7de-a741-4f57-8e19-d661b1a98b6a'
 );