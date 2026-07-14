
CREATE TABLE public.creator_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  story_idea TEXT NOT NULL,
  age_band TEXT NOT NULL DEFAULT '4-6',
  theme_slug TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT creator_submissions_email_check CHECK (char_length(email) <= 255 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT creator_submissions_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT creator_submissions_idea_check CHECK (char_length(story_idea) BETWEEN 30 AND 4000)
);

GRANT INSERT ON public.creator_submissions TO anon;
GRANT INSERT ON public.creator_submissions TO authenticated;
GRANT ALL ON public.creator_submissions TO service_role;

ALTER TABLE public.creator_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit an idea"
  ON public.creator_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view submissions"
  ON public.creator_submissions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update submissions"
  ON public.creator_submissions
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete submissions"
  ON public.creator_submissions
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER creator_submissions_set_updated_at
  BEFORE UPDATE ON public.creator_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
