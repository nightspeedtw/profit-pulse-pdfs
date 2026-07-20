
ALTER TABLE public.coloring_v2_books
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS stage_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS stage_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS idx_coloring_v2_books_stage ON public.coloring_v2_books(stage, stage_updated_at);

CREATE OR REPLACE FUNCTION public.coloring_v2_advance_stage(
  p_book uuid,
  p_from text,
  p_to text,
  p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.coloring_v2_books
     SET stage = p_to,
         stage_updated_at = now(),
         stage_attempt_count = 0,
         last_error = NULL,
         updated_at = now(),
         generation_status = CASE
           WHEN p_to = 'publish' THEN 'completed'
           WHEN p_to = 'failed' THEN 'failed'
           ELSE COALESCE(generation_status, 'running')
         END
   WHERE id = p_book
     AND (p_from IS NULL OR stage = p_from);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN false;
  END IF;

  IF p_patch IS NOT NULL AND p_patch <> '{}'::jsonb THEN
    UPDATE public.coloring_v2_books b
       SET title = COALESCE(p_patch->>'title', b.title),
           subtitle = COALESCE(p_patch->>'subtitle', b.subtitle),
           approved_cover_asset_id = COALESCE((p_patch->>'approved_cover_asset_id')::uuid, b.approved_cover_asset_id),
           final_pdf_asset_id = COALESCE((p_patch->>'final_pdf_asset_id')::uuid, b.final_pdf_asset_id),
           final_pdf_sha256 = COALESCE(p_patch->>'final_pdf_sha256', b.final_pdf_sha256),
           overall_qc_score = COALESCE((p_patch->>'overall_qc_score')::numeric, b.overall_qc_score),
           publish_status = COALESCE(p_patch->>'publish_status', b.publish_status),
           qc_status = COALESCE(p_patch->>'qc_status', b.qc_status),
           sellability_status = COALESCE(p_patch->>'sellability_status', b.sellability_status),
           time_completed_at = CASE WHEN p_to = 'publish' THEN now() ELSE b.time_completed_at END
     WHERE b.id = p_book;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.coloring_v2_record_error(
  p_book uuid,
  p_stage text,
  p_error text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.coloring_v2_books
     SET stage_attempt_count = stage_attempt_count + 1,
         last_error = left(coalesce(p_error, ''), 800),
         updated_at = now()
   WHERE id = p_book AND stage = p_stage;
END;
$$;

REVOKE ALL ON FUNCTION public.coloring_v2_advance_stage(uuid, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.coloring_v2_advance_stage(uuid, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.coloring_v2_record_error(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.coloring_v2_record_error(uuid, text, text) TO service_role;
