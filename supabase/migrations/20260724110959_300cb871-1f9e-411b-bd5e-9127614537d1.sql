-- Reset attempt counts + touch stage_updated_at so tick will pick these books.
-- Prioritize by proximity to publish (near-completion first).
UPDATE public.coloring_v2_books
SET stage_attempt_count = 0,
    last_error = NULL,
    stage_updated_at = CASE stage
      WHEN 'publish' THEN now() - interval '10 minutes'
      WHEN 'pdf'     THEN now() - interval '9 minutes'
      WHEN 'qc'      THEN now() - interval '8 minutes'
      WHEN 'cover'   THEN now() - interval '7 minutes'
      WHEN 'interior_render' THEN now() - interval '6 minutes'
      WHEN 'page_plan'   THEN now() - interval '5 minutes'
      WHEN 'style_bible' THEN now() - interval '4 minutes'
      WHEN 'concept'     THEN now() - interval '3 minutes'
      WHEN 'queued'      THEN now() - interval '2 minutes'
      ELSE stage_updated_at
    END
WHERE publish_status <> 'live' AND stage <> 'failed';