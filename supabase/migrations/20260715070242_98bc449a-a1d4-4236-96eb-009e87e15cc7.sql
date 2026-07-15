
ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS ever_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS identity_locked_at timestamptz;

-- Backfill: any row that was ever published, or is currently live, or has a built PDF while retired
UPDATE public.ebooks_kids
   SET ever_live = true
 WHERE listing_status = 'live'
    OR pipeline_status = 'published'
    OR (pdf_url IS NOT NULL AND pipeline_status IN ('retired','published'));

-- Backfill identity_locked_at for rows that already have manuscript content
UPDATE public.ebooks_kids
   SET identity_locked_at = COALESCE(updated_at, created_at, now())
 WHERE manuscript_md IS NOT NULL
   AND length(manuscript_md) > 0
   AND identity_locked_at IS NULL;

-- Guard trigger
CREATE OR REPLACE FUNCTION public.ebooks_kids_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override text;
  v_content_changed boolean;
  v_has_holdings boolean;
BEGIN
  -- Escape hatch: per-session GUC set by admin flows
  BEGIN
    v_override := current_setting('app.allow_identity_override', true);
  EXCEPTION WHEN OTHERS THEN
    v_override := NULL;
  END;
  IF v_override = 'on' THEN
    -- Auto-set identity_locked_at when manuscript first appears
    IF NEW.manuscript_md IS NOT NULL AND length(NEW.manuscript_md) > 0
       AND NEW.identity_locked_at IS NULL THEN
      NEW.identity_locked_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Detect content-identity changes
  v_content_changed := (
       COALESCE(NEW.title,'')         IS DISTINCT FROM COALESCE(OLD.title,'')
    OR COALESCE(NEW.subtitle,'')      IS DISTINCT FROM COALESCE(OLD.subtitle,'')
    OR COALESCE(NEW.description,'')   IS DISTINCT FROM COALESCE(OLD.description,'')
    OR COALESCE(NEW.manuscript_md,'') IS DISTINCT FROM COALESCE(OLD.manuscript_md,'')
    OR COALESCE(NEW.story_bible::text,'') IS DISTINCT FROM COALESCE(OLD.story_bible::text,'')
  );

  IF v_content_changed THEN
    IF OLD.pipeline_status = 'retired' THEN
      RAISE EXCEPTION 'ebooks_kids identity_guard: row % is retired; title/manuscript/story_bible are immutable (a new row must be inserted).', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(OLD.ever_live, false) THEN
      RAISE EXCEPTION 'ebooks_kids identity_guard: row % was live/published; identity is immutable.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.identity_locked_at IS NOT NULL THEN
      -- identity was previously locked (manuscript exists); disallow overwrite
      RAISE EXCEPTION 'ebooks_kids identity_guard: row % has locked identity (locked_at=%); insert a new row instead.',
        OLD.id, OLD.identity_locked_at USING ERRCODE = 'check_violation';
    END IF;

    -- Money linkage: royalty_holdings
    SELECT EXISTS (SELECT 1 FROM public.royalty_holdings h WHERE h.book_id = OLD.id) INTO v_has_holdings;
    IF v_has_holdings THEN
      RAISE EXCEPTION 'ebooks_kids identity_guard: row % has royalty_holdings; identity is immutable.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Auto-lock identity the first time manuscript is written
  IF NEW.manuscript_md IS NOT NULL AND length(NEW.manuscript_md) > 0
     AND (OLD.manuscript_md IS NULL OR length(OLD.manuscript_md) = 0)
     AND NEW.identity_locked_at IS NULL THEN
    NEW.identity_locked_at := now();
  END IF;

  -- Mark ever_live when it flips to live
  IF NEW.listing_status = 'live' AND COALESCE(OLD.ever_live, false) = false THEN
    NEW.ever_live := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ebooks_kids_identity_guard_trg ON public.ebooks_kids;
CREATE TRIGGER ebooks_kids_identity_guard_trg
  BEFORE UPDATE ON public.ebooks_kids
  FOR EACH ROW EXECUTE FUNCTION public.ebooks_kids_identity_guard();

-- Skill row recording the rule
INSERT INTO public.pipeline_skills
  (skill_key, version, content_md, source, target_dimension, sort_index, metadata)
VALUES (
  'book_identity_immutable',
  1,
  E'# Book identity is immutable\n\nA book_id is never reused. Every concept attempt inserts a NEW ebooks_kids row.\n\nA row is a TOMBSTONE (read-only for title/subtitle/description/manuscript_md/story_bible) if ANY of:\n- it has ever been listing_status=''live'' (ever_live=true)\n- it has pipeline_status=''retired'' or ''published''\n- it has identity_locked_at set (manuscript already exists)\n- any royalty_holdings/book_royalty_markets/book_sales_ledger row references it\n\nEnforced at the DB layer by trigger `ebooks_kids_identity_guard`. Code paths (fresh-book-start, one-click-build, repair supervisor, watchdog) MUST insert new rows instead of overwriting; the escape hatch (SET LOCAL app.allow_identity_override=''on'') is reserved for admin recovery flows and must never be used in autopilot.',
  'learned',
  'data_integrity',
  10,
  jsonb_build_object('reason', 'row_recycling_destroyed_flicker_and_15_other_rows', 'trigger', 'ebooks_kids_identity_guard')
)
ON CONFLICT (skill_key, version) DO UPDATE SET
  content_md = EXCLUDED.content_md,
  metadata = EXCLUDED.metadata;
