CREATE TABLE IF NOT EXISTS public.sample_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  first_name text,
  book_id uuid REFERENCES public.ebooks_kids(id) ON DELETE SET NULL,
  product_slug text,
  product_category text,
  lead_source text NOT NULL DEFAULT 'free_sample',
  sample_pdf_url text,
  drip_stage int NOT NULL DEFAULT 0,
  drip_next_at timestamptz NOT NULL DEFAULT now(),
  drip_last_sent_at timestamptz,
  drip_last_error text,
  unsubscribed_at timestamptz,
  ip_hash text,
  user_agent text
);

GRANT ALL ON public.sample_leads TO service_role;

ALTER TABLE public.sample_leads ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated policies: all reads/writes go through
-- edge functions running with the service role.

CREATE INDEX IF NOT EXISTS sample_leads_drip_due_idx
  ON public.sample_leads (drip_next_at)
  WHERE unsubscribed_at IS NULL AND drip_stage < 3;

CREATE INDEX IF NOT EXISTS sample_leads_email_book_idx
  ON public.sample_leads (email, book_id);

CREATE INDEX IF NOT EXISTS sample_leads_created_at_idx
  ON public.sample_leads (created_at DESC);

CREATE TRIGGER sample_leads_set_updated_at
  BEFORE UPDATE ON public.sample_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
