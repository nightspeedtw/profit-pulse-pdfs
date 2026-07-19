
CREATE OR REPLACE FUNCTION public.atomic_patch_ebooks_kids_meta(p_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb;
  v_key text;
BEGIN
  -- Merge patch into metadata atomically.
  -- Keys whose value in p_patch is JSON null are DELETED from metadata
  -- (matches the intent of "set X = null" callers used with read-modify-write).
  UPDATE public.ebooks_kids
     SET metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb)
   WHERE id = p_id
  RETURNING metadata INTO v_new;

  IF v_new IS NULL THEN
    RETURN NULL;
  END IF;

  -- Strip JSON-null keys so callers can null-out fields
  FOR v_key IN SELECT key FROM jsonb_each(p_patch) WHERE jsonb_typeof(value) = 'null' LOOP
    v_new := v_new - v_key;
  END LOOP;

  UPDATE public.ebooks_kids SET metadata = v_new WHERE id = p_id;
  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atomic_patch_ebooks_kids_meta(uuid, jsonb) TO service_role;
