
-- Live-assets invariant: a row may not be live/sellable while pdf_url or cover_url is NULL.
-- Any update that nulls pdf_url/cover_url on a live/sellable row is forced to draft+unsellable
-- with blocker_reason='assets_rebuilding'. New rows that violate the invariant are also demoted.
CREATE OR REPLACE FUNCTION public.ebooks_kids_live_assets_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override text;
BEGIN
  BEGIN
    v_override := current_setting('app.allow_live_assets_override', true);
  EXCEPTION WHEN OTHERS THEN
    v_override := NULL;
  END;
  IF v_override = 'on' THEN
    RETURN NEW;
  END IF;

  IF (NEW.pdf_url IS NULL OR NEW.cover_url IS NULL)
     AND (NEW.listing_status = 'live' OR COALESCE(NEW.sellable, false) = true) THEN
    NEW.listing_status := 'draft';
    NEW.sellable := false;
    NEW.blocker_reason := COALESCE(NULLIF(NEW.blocker_reason, ''), 'assets_rebuilding');
    RAISE WARNING 'ebooks_kids live_assets_guard: row % had null pdf_url/cover_url while live/sellable — demoted to draft (assets_rebuilding).', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ebooks_kids_live_assets_guard_trg ON public.ebooks_kids;
CREATE TRIGGER ebooks_kids_live_assets_guard_trg
BEFORE INSERT OR UPDATE ON public.ebooks_kids
FOR EACH ROW EXECUTE FUNCTION public.ebooks_kids_live_assets_guard();

-- Backfill any current violators (there should be none after the manual delisting, but enforce).
UPDATE public.ebooks_kids
   SET listing_status = 'draft',
       sellable = false,
       blocker_reason = COALESCE(NULLIF(blocker_reason, ''), 'assets_rebuilding')
 WHERE (pdf_url IS NULL OR cover_url IS NULL)
   AND (listing_status = 'live' OR sellable = true);
