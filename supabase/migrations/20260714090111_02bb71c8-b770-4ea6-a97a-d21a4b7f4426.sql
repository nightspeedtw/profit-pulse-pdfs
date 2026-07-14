
-- 1. Public read of enabled categories
CREATE POLICY "public read enabled categories"
  ON public.categories FOR SELECT
  TO anon, authenticated
  USING (enabled = true);
GRANT SELECT ON public.categories TO anon;

-- 2. Public read of live ebooks
CREATE POLICY "public read live ebooks"
  ON public.ebooks FOR SELECT
  TO anon, authenticated
  USING (listing_status = 'live');
GRANT SELECT ON public.ebooks TO anon;

-- 3. Creator submissions: validate email + basic anti-spam via trigger
CREATE OR REPLACE FUNCTION public.creator_submissions_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  recent_count int;
BEGIN
  IF NEW.email IS NULL OR length(NEW.email) > 254 OR NEW.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;
  IF NEW.idea IS NOT NULL AND length(NEW.idea) > 5000 THEN
    RAISE EXCEPTION 'idea too long';
  END IF;
  SELECT count(*) INTO recent_count
    FROM public.creator_submissions
   WHERE email = NEW.email
     AND created_at > now() - interval '1 hour';
  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'rate limit exceeded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creator_submissions_validate_trg ON public.creator_submissions;
CREATE TRIGGER creator_submissions_validate_trg
  BEFORE INSERT ON public.creator_submissions
  FOR EACH ROW EXECUTE FUNCTION public.creator_submissions_validate();

-- Lock down function execution (no signed-in users need to call it directly)
REVOKE EXECUTE ON FUNCTION public.creator_submissions_validate() FROM PUBLIC, anon, authenticated;
