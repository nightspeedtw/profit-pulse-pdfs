CREATE OR REPLACE FUNCTION public.prune_coloring_metadata_bloat(p_meta jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb := COALESCE(p_meta, '{}'::jsonb);
BEGIN
  v := v
    - 'cover_pending_verify'
    - 'cover_pending_verify_url'
    - 'coloring_cover_ideogram_attempts'
    - 'coloring_cover_single_attempt';
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_coloring_book_metadata_bloat(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_meta jsonb;
BEGIN
  UPDATE public.ebooks_kids
     SET metadata = public.prune_coloring_metadata_bloat(metadata)
   WHERE id = p_id
     AND book_type = 'coloring_book'
  RETURNING metadata INTO v_meta;

  RETURN v_meta;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_coloring_metadata_bloat(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_coloring_book_metadata_bloat(uuid) TO service_role;

UPDATE public.ebooks_kids
   SET metadata = public.prune_coloring_metadata_bloat(metadata) || jsonb_build_object(
         'coloring_cover_invocations', GREATEST(COALESCE(NULLIF(metadata->>'coloring_cover_invocations','')::int, 0), 8),
         'awaiting', 'cover_pdf_publish',
         'coloring_current_step_label', 'Metadata pruned; deterministic cover rebuild queued',
         'metadata_pruned_at', now()
       ),
       pipeline_status = 'queued',
       blocker_reason = NULL
 WHERE id = 'd6da92a8-5eaa-455e-9d00-8b8780cae9d1'
   AND book_type = 'coloring_book';