
-- Ensure app_role enum + has_role function exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ebooks_kids
CREATE TABLE public.ebooks_kids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  subtitle text,
  description text,
  storefront_title text,
  storefront_subtitle text,
  storefront_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'idea',
  listing_status text NOT NULL DEFAULT 'draft',
  pipeline_status text NOT NULL DEFAULT 'idea',
  age_group_id uuid REFERENCES public.kids_age_groups(id) ON DELETE SET NULL,
  theme_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  cover_url text,
  pdf_url text,
  page_count int,
  word_count int,
  price_cents int NOT NULL DEFAULT 499,
  manuscript_md text,
  story_bible jsonb,
  qc_scores jsonb,
  blocker_reason text,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ebooks_kids TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebooks_kids TO authenticated;
GRANT ALL ON public.ebooks_kids TO service_role;
ALTER TABLE public.ebooks_kids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kids public read live" ON public.ebooks_kids FOR SELECT USING (listing_status = 'live');
CREATE POLICY "kids admin all" ON public.ebooks_kids FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE TRIGGER trg_ebooks_kids_updated BEFORE UPDATE ON public.ebooks_kids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.autopilot_kids_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_kids_id uuid REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  current_step text,
  current_step_label text,
  progress_percent int DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  blocker_reason text,
  error_details jsonb,
  cost_usd numeric DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.autopilot_kids_runs TO authenticated;
GRANT ALL ON public.autopilot_kids_runs TO service_role;
ALTER TABLE public.autopilot_kids_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kids runs admin all" ON public.autopilot_kids_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE TRIGGER trg_akr_updated BEFORE UPDATE ON public.autopilot_kids_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.autopilot_kids_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.autopilot_kids_runs(id) ON DELETE CASCADE,
  step_name text NOT NULL,
  step_label text,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms int,
  error_message text,
  output jsonb,
  cost_usd numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.autopilot_kids_steps TO authenticated;
GRANT ALL ON public.autopilot_kids_steps TO service_role;
ALTER TABLE public.autopilot_kids_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kids steps admin all" ON public.autopilot_kids_steps FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE TRIGGER trg_aks_updated BEFORE UPDATE ON public.autopilot_kids_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.kids_production_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_kids_id uuid REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  age_group_id uuid REFERENCES public.kids_age_groups(id) ON DELETE SET NULL,
  theme_id uuid REFERENCES public.kids_themes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  priority int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kids_production_queue TO authenticated;
GRANT ALL ON public.kids_production_queue TO service_role;
ALTER TABLE public.kids_production_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kids queue admin all" ON public.kids_production_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE TRIGGER trg_kpq_updated BEFORE UPDATE ON public.kids_production_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.kids_download_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_kids_id uuid NOT NULL REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  order_id uuid,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  download_count int NOT NULL DEFAULT 0,
  max_downloads int NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  last_downloaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kids_download_grants TO authenticated;
GRANT ALL ON public.kids_download_grants TO service_role;
ALTER TABLE public.kids_download_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kids grants admin all" ON public.kids_download_grants FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE INDEX kids_grants_token_idx ON public.kids_download_grants(token);
CREATE TRIGGER trg_kdg_updated BEFORE UPDATE ON public.kids_download_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.kids_category_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  age_group_id uuid NOT NULL REFERENCES public.kids_age_groups(id) ON DELETE CASCADE,
  theme_id uuid NOT NULL REFERENCES public.kids_themes(id) ON DELETE CASCADE,
  weight int NOT NULL DEFAULT 10,
  sales_last_30d int NOT NULL DEFAULT 0,
  auto_managed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (age_group_id, theme_id)
);
GRANT SELECT ON public.kids_category_weights TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kids_category_weights TO authenticated;
GRANT ALL ON public.kids_category_weights TO service_role;
ALTER TABLE public.kids_category_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kids weights public read" ON public.kids_category_weights FOR SELECT USING (true);
CREATE POLICY "kids weights admin write" ON public.kids_category_weights FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE TRIGGER trg_kcw_updated BEFORE UPDATE ON public.kids_category_weights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.kids_category_weights (age_group_id, theme_id, weight)
SELECT a.id, t.id, 10 FROM public.kids_age_groups a CROSS JOIN public.kids_themes t
ON CONFLICT DO NOTHING;

CREATE INDEX ebooks_kids_status_idx ON public.ebooks_kids(status);
CREATE INDEX ebooks_kids_listing_idx ON public.ebooks_kids(listing_status);
CREATE INDEX akr_ebook_idx ON public.autopilot_kids_runs(ebook_kids_id);
CREATE INDEX akr_status_idx ON public.autopilot_kids_runs(status);
CREATE INDEX aks_run_idx ON public.autopilot_kids_steps(run_id);
CREATE INDEX kpq_status_idx ON public.kids_production_queue(status);
