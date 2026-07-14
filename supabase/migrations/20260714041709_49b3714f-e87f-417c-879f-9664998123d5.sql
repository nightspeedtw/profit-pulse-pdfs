
CREATE TABLE IF NOT EXISTS public.kids_launch_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ebook_id uuid REFERENCES public.ebooks_kids(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'kids_checkout_waitlist',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kids_launch_leads_email_idx ON public.kids_launch_leads (email);
CREATE INDEX IF NOT EXISTS kids_launch_leads_ebook_idx ON public.kids_launch_leads (ebook_id);

GRANT INSERT ON public.kids_launch_leads TO anon, authenticated;
GRANT ALL   ON public.kids_launch_leads TO service_role;

ALTER TABLE public.kids_launch_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.kids_launch_leads;
CREATE POLICY "Anyone can join waitlist"
  ON public.kids_launch_leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$');

DROP POLICY IF EXISTS "Admins can read leads" ON public.kids_launch_leads;
CREATE POLICY "Admins can read leads"
  ON public.kids_launch_leads
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
