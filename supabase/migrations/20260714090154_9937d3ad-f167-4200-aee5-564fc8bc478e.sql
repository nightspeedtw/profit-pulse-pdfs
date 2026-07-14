
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
  IF NEW.story_idea IS NULL OR length(NEW.story_idea) > 4000 THEN
    RAISE EXCEPTION 'invalid story_idea';
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
REVOKE EXECUTE ON FUNCTION public.creator_submissions_validate() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Anyone can submit an idea" ON public.creator_submissions;
CREATE POLICY "Anyone can submit an idea"
  ON public.creator_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND length(email) BETWEEN 5 AND 254
    AND story_idea IS NOT NULL
    AND length(story_idea) BETWEEN 30 AND 4000
  );
