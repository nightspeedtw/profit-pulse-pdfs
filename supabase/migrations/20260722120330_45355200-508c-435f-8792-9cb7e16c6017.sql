
-- Permanent trigger: coloring books require verified cover-spelling evidence
-- before listing_status='live' or sellable=true. Blocks the "unicorn with
-- misspelled title + deformed anatomy" class of defect from ever going live
-- again. Escape hatch: session GUC app.allow_coloring_spelling_override='on'.

CREATE OR REPLACE FUNCTION public.ebooks_kids_coloring_spelling_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override text;
  v_ocr_pass text;
  v_going_live boolean;
BEGIN
  BEGIN
    v_override := current_setting('app.allow_coloring_spelling_override', true);
  EXCEPTION WHEN OTHERS THEN
    v_override := NULL;
  END;
  IF v_override = 'on' THEN RETURN NEW; END IF;

  IF NEW.book_type IS DISTINCT FROM 'coloring_book' THEN
    RETURN NEW;
  END IF;

  v_going_live := (NEW.listing_status = 'live' OR COALESCE(NEW.sellable, false) = true);
  IF NOT v_going_live THEN RETURN NEW; END IF;

  v_ocr_pass := NEW.metadata #>> '{coloring_cover,evidence,transcription,pass}';

  IF v_ocr_pass IS DISTINCT FROM 'true' THEN
    NEW.listing_status := 'draft';
    NEW.sellable := false;
    NEW.blocker_reason := COALESCE(
      NULLIF(NEW.blocker_reason, ''),
      'cover_spelling_unverified_v1'
    );
    RAISE WARNING 'coloring_spelling_guard: row % (%) demoted to draft — no cover_spelling evidence (ocr_pass=%).',
      NEW.id, NEW.title, COALESCE(v_ocr_pass, 'null');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ebooks_kids_coloring_spelling_guard ON public.ebooks_kids;
CREATE TRIGGER trg_ebooks_kids_coloring_spelling_guard
BEFORE INSERT OR UPDATE ON public.ebooks_kids
FOR EACH ROW
EXECUTE FUNCTION public.ebooks_kids_coloring_spelling_guard();

-- One-shot backfill: demote 36 legacy V1 coloring books that never had OCR
-- evidence written. Autopilot will pick them up and re-run the V2 cover flow.
UPDATE public.ebooks_kids
   SET listing_status = 'draft',
       sellable = false,
       blocker_reason = COALESCE(NULLIF(blocker_reason,''), 'cover_spelling_unverified_legacy_v1')
 WHERE book_type = 'coloring_book'
   AND (listing_status = 'live' OR sellable = true)
   AND (metadata #>> '{coloring_cover,evidence,transcription,pass}') IS DISTINCT FROM 'true';
