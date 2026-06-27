
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Bootstrap: first signed-in user becomes admin automatically (one-time)
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_bootstrap_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_admin();

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Enums for pipeline status
CREATE TYPE public.ebook_status AS ENUM (
  'idea','outline','writing','qc_failed','approved','uploaded','published','rejected'
);
CREATE TYPE public.generation_mode AS ENUM ('low_cost','premium','hybrid');
CREATE TYPE public.job_status AS ENUM ('queued','running','done','failed');

-- Categories
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  default_price numeric(10,2) NOT NULL DEFAULT 24.99,
  cover_style_prompt text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all categories" ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Ideas (raw concepts scored before becoming ebooks)
CREATE TABLE public.ebook_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  title text NOT NULL,
  subtitle text,
  target_buyer text,
  hook text,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_score numeric(5,2) NOT NULL DEFAULT 0,
  status public.ebook_status NOT NULL DEFAULT 'idea',
  notes text,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebook_ideas TO authenticated;
GRANT ALL ON public.ebook_ideas TO service_role;
ALTER TABLE public.ebook_ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all ideas" ON public.ebook_ideas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ideas_status ON public.ebook_ideas(status);
CREATE INDEX idx_ideas_category ON public.ebook_ideas(category_id);
CREATE TRIGGER trg_ideas_updated BEFORE UPDATE ON public.ebook_ideas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Ebooks (full content + QC + shopify state)
CREATE TABLE public.ebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid REFERENCES public.ebook_ideas(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  title text NOT NULL,
  subtitle text,
  target_buyer text,
  hook text,
  toc jsonb NOT NULL DEFAULT '[]'::jsonb,
  chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  bonuses jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_description text,
  seo_title text,
  seo_meta text,
  tags text[] NOT NULL DEFAULT '{}',
  cover_prompt text,
  cover_url text,
  pdf_url text,
  word_count integer NOT NULL DEFAULT 0,
  qc jsonb NOT NULL DEFAULT '{}'::jsonb,
  price numeric(10,2) NOT NULL DEFAULT 24.99,
  vendor text NOT NULL DEFAULT 'Printly',
  product_type text NOT NULL DEFAULT 'Digital Ebook',
  shopify_product_id text,
  shopify_handle text,
  status public.ebook_status NOT NULL DEFAULT 'outline',
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebooks TO authenticated;
GRANT ALL ON public.ebooks TO service_role;
ALTER TABLE public.ebooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all ebooks" ON public.ebooks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ebooks_status ON public.ebooks(status);
CREATE INDEX idx_ebooks_title_lower ON public.ebooks(lower(title));
CREATE TRIGGER trg_ebooks_updated BEFORE UPDATE ON public.ebooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Singleton settings
CREATE TABLE public.generation_settings (
  id integer PRIMARY KEY DEFAULT 1,
  daily_quota integer NOT NULL DEFAULT 5,
  mode public.generation_mode NOT NULL DEFAULT 'hybrid',
  enabled_category_ids uuid[] NOT NULL DEFAULT '{}',
  min_score_threshold numeric(5,2) NOT NULL DEFAULT 35,
  min_word_count integer NOT NULL DEFAULT 8000,
  max_refund_risk numeric(5,2) NOT NULL DEFAULT 6,
  daily_budget_usd numeric(10,2) NOT NULL DEFAULT 5,
  auto_publish boolean NOT NULL DEFAULT false,
  cron_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.generation_settings TO authenticated;
GRANT ALL ON public.generation_settings TO service_role;
ALTER TABLE public.generation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin settings" ON public.generation_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.generation_settings (id) VALUES (1);

-- Cost log
CREATE TABLE public.cost_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id uuid REFERENCES public.ebooks(id) ON DELETE SET NULL,
  idea_id uuid REFERENCES public.ebook_ideas(id) ON DELETE SET NULL,
  step text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.cost_log TO authenticated;
GRANT ALL ON public.cost_log TO service_role;
ALTER TABLE public.cost_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read costs" ON public.cost_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_cost_log_created ON public.cost_log(created_at);

-- Generation jobs queue
CREATE TABLE public.generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.job_status NOT NULL DEFAULT 'queued',
  error text,
  ebook_id uuid REFERENCES public.ebooks(id) ON DELETE SET NULL,
  idea_id uuid REFERENCES public.ebook_ideas(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generation_jobs TO authenticated;
GRANT ALL ON public.generation_jobs TO service_role;
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all jobs" ON public.generation_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_jobs_status ON public.generation_jobs(status, scheduled_for);

-- Seed default categories
INSERT INTO public.categories (name, slug, description, default_price, cover_style_prompt) VALUES
  ('Personal Finance', 'personal-finance', 'Money habits, budgeting, investing basics, debt-free living', 24.99, 'minimalist editorial cover, navy and gold, clean typography'),
  ('Productivity', 'productivity', 'Focus, deep work, time management, systems', 19.99, 'bold neo-brutalist cover, high contrast, geometric shapes'),
  ('Health & Wellness', 'health-wellness', 'Sleep, energy, habits, mental health', 22.99, 'calming gradient cover, soft sage and cream, modern serif'),
  ('Career & Side Hustle', 'career-side-hustle', 'Freelancing, remote work, income streams, negotiation', 29.99, 'professional editorial cover, deep teal and orange accents');
