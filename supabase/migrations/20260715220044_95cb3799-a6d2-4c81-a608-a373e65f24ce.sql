
CREATE OR REPLACE FUNCTION public.ebooks_kids_terminal_quality_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override text;
BEGIN
  BEGIN
    v_override := current_setting('app.allow_terminal_override', true);
  EXCEPTION WHEN OTHERS THEN
    v_override := NULL;
  END;
  IF v_override = 'on' THEN
    RETURN NEW;
  END IF;

  -- Once a book has a valid PDF and overall QC >= 90, it cannot be moved to
  -- 'retired'. Publishing is a separate concern; content quality has been
  -- proven and the row must remain repair/publish-eligible.
  IF NEW.pipeline_status = 'retired'
     AND OLD.pipeline_status IS DISTINCT FROM 'retired'
     AND COALESCE(NEW.pdf_url, OLD.pdf_url) IS NOT NULL
     AND COALESCE(NEW.overall_qc_score, OLD.overall_qc_score, 0) >= 90 THEN
    RAISE EXCEPTION 'ebooks_kids terminal_quality_guard: row % has valid PDF + overall_qc_score >= 90; cannot be retired (blocker_reason=%).',
      OLD.id, NEW.blocker_reason USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ebooks_kids_terminal_quality_guard ON public.ebooks_kids;
CREATE TRIGGER ebooks_kids_terminal_quality_guard
  BEFORE UPDATE ON public.ebooks_kids
  FOR EACH ROW EXECUTE FUNCTION public.ebooks_kids_terminal_quality_guard();

-- Rescue the perfect fixture cbba85fc: unretire it (it has qc=100, valid PDF).
UPDATE public.ebooks_kids
   SET pipeline_status = 'human_review_required',
       blocker_reason = 'rescued_from_phantom_retire: overall_qc=100, valid pdf. See terminal_quality_guard.'
 WHERE id = 'cbba85fc-a332-4c44-9735-bfb64244bb59'
   AND pipeline_status = 'retired';
