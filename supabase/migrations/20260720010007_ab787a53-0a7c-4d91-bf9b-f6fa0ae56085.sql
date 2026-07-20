
-- ============================================================
-- Premium Coloring Book Lane V2 — isolated schema (additive only)
-- No existing table, function, policy, or grant is modified.
-- Every table is namespaced coloring_v2_*.
-- ============================================================

-- 1. Age bands (V2-only; existing coloring_age_bands untouched)
CREATE TABLE IF NOT EXISTS public.coloring_v2_age_bands (
  slug           text PRIMARY KEY,
  label          text NOT NULL,
  min_age        int  NOT NULL,
  max_age        int  NOT NULL,
  line_weight    text NOT NULL,
  regions_min    int  NOT NULL,
  regions_max    int  NOT NULL,
  focal_count    int  NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coloring_v2_age_bands TO authenticated;
GRANT ALL    ON public.coloring_v2_age_bands TO service_role;
ALTER TABLE public.coloring_v2_age_bands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 age bands admin read" ON public.coloring_v2_age_bands
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.coloring_v2_age_bands
  (slug, label, min_age, max_age, line_weight, regions_min, regions_max, focal_count, notes)
VALUES
  ('4-6',  'Big & Easy',           4,  6,  'thick',   15,  30, 1, 'Large closed regions, no crosshatch'),
  ('7-9',  'Growing Detail',       7,  9,  'medium',  30,  60, 3, 'Story elements, some background'),
  ('8-12', 'Detailed Adventure',   8, 12,  'medium-thin', 50, 100, 4, 'Full scene, controlled detail'),
  ('13+',  'Advanced Coloring',   13, 99,  'thin',    80, 160, 5, 'Patterns/textures allowed, still clean')
ON CONFLICT (slug) DO NOTHING;

-- 2. Books
CREATE TABLE IF NOT EXISTS public.coloring_v2_books (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text,
  subtitle              text,
  language              text NOT NULL DEFAULT 'en',
  age_band              text NOT NULL REFERENCES public.coloring_v2_age_bands(slug),
  theme                 text NOT NULL,
  theme_mode            text NOT NULL DEFAULT 'select', -- select|custom|random|surprise
  page_count            int  NOT NULL CHECK (page_count IN (16,32)),
  trim_inches           numeric NOT NULL DEFAULT 8.5,
  complexity_mode       text NOT NULL DEFAULT 'auto',
  educational_facts     boolean NOT NULL DEFAULT false,
  cover_mood            text,
  main_character_mode   text NOT NULL DEFAULT 'auto',
  provider_mode         text NOT NULL DEFAULT 'auto',
  autopilot_mode        text NOT NULL DEFAULT 'full_auto',
  seed_lock             bigint,
  max_retry_per_page    int  NOT NULL DEFAULT 5,
  daily_cost_ceiling_usd numeric NOT NULL DEFAULT 25,
  -- independent status columns (no reuse of v1 semantics)
  generation_status     text NOT NULL DEFAULT 'queued',       -- queued|running|paused|completed|failed
  qc_status             text NOT NULL DEFAULT 'pending',      -- pending|running|repairing|passed|failed|human_review_required
  sellability_status    text NOT NULL DEFAULT 'unknown',      -- unknown|not_sellable|sellable
  publish_status        text NOT NULL DEFAULT 'draft',        -- draft|ready|published|unpublished
  approved_cover_asset_id uuid,
  final_pdf_asset_id    uuid,
  final_pdf_sha256      text,
  overall_qc_score      numeric,
  typography_qc_score   numeric,
  cost_actual_usd       numeric NOT NULL DEFAULT 0,
  time_started_at       timestamptz,
  time_completed_at     timestamptz,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_books TO authenticated;
GRANT ALL ON public.coloring_v2_books TO service_role;
ALTER TABLE public.coloring_v2_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 books admin all" ON public.coloring_v2_books
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS coloring_v2_books_gen_status_idx ON public.coloring_v2_books(generation_status);
CREATE INDEX IF NOT EXISTS coloring_v2_books_qc_status_idx  ON public.coloring_v2_books(qc_status);

-- 3. Runs
CREATE TABLE IF NOT EXISTS public.coloring_v2_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id          uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'running',
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  cost_usd         numeric NOT NULL DEFAULT 0,
  notes            text
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_runs TO authenticated;
GRANT ALL ON public.coloring_v2_runs TO service_role;
ALTER TABLE public.coloring_v2_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 runs admin all" ON public.coloring_v2_runs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS coloring_v2_runs_book_idx ON public.coloring_v2_runs(book_id);

-- 4. Steps
CREATE TABLE IF NOT EXISTS public.coloring_v2_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.coloring_v2_runs(id) ON DELETE CASCADE,
  book_id          uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  step_name        text NOT NULL,
  status           text NOT NULL DEFAULT 'queued',
  attempt          int  NOT NULL DEFAULT 0,
  started_at       timestamptz,
  completed_at     timestamptz,
  cost_usd         numeric NOT NULL DEFAULT 0,
  input_hash       text,
  output_hash      text,
  error_message    text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_steps TO authenticated;
GRANT ALL ON public.coloring_v2_steps TO service_role;
ALTER TABLE public.coloring_v2_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 steps admin all" ON public.coloring_v2_steps
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS coloring_v2_steps_book_idx ON public.coloring_v2_steps(book_id);

-- 5. Style bibles
CREATE TABLE IF NOT EXISTS public.coloring_v2_style_bibles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      uuid NOT NULL UNIQUE REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  bible        jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_style_bibles TO authenticated;
GRANT ALL ON public.coloring_v2_style_bibles TO service_role;
ALTER TABLE public.coloring_v2_style_bibles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 style bibles admin all" ON public.coloring_v2_style_bibles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 6. Character bibles
CREATE TABLE IF NOT EXISTS public.coloring_v2_character_bibles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  name         text,
  bible        jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_character_bibles TO authenticated;
GRANT ALL ON public.coloring_v2_character_bibles TO service_role;
ALTER TABLE public.coloring_v2_character_bibles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 char bibles admin all" ON public.coloring_v2_character_bibles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 7. Page plans
CREATE TABLE IF NOT EXISTS public.coloring_v2_page_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  page_number    int  NOT NULL,
  purpose        text NOT NULL,
  scene          text NOT NULL,
  focal_subject  text NOT NULL,
  action         text,
  supporting     text,
  framing        text,
  detail_target  text,
  continuity     text,
  forbidden      text,
  fact           text,
  prompt         text NOT NULL,
  fingerprint    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, page_number),
  UNIQUE (book_id, fingerprint)
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_page_plans TO authenticated;
GRANT ALL ON public.coloring_v2_page_plans TO service_role;
ALTER TABLE public.coloring_v2_page_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 page plans admin all" ON public.coloring_v2_page_plans
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 8. Assets (interior/cover/lettering/thumbnail/pdf render preview)
CREATE TABLE IF NOT EXISTS public.coloring_v2_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  run_id       uuid REFERENCES public.coloring_v2_runs(id) ON DELETE SET NULL,
  page_number  int,                        -- null for cover/lettering/thumbnail
  kind         text NOT NULL,              -- cover_bg|cover_lettering|cover_composite|cover_thumb|interior|pdf_page_render
  storage_path text NOT NULL,
  mime         text NOT NULL DEFAULT 'image/png',
  width        int,
  height       int,
  sha256       text,
  provider     text,
  model        text,
  seed         bigint,
  prompt_version text,
  cost_usd     numeric NOT NULL DEFAULT 0,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_assets TO authenticated;
GRANT ALL ON public.coloring_v2_assets TO service_role;
ALTER TABLE public.coloring_v2_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 assets admin all" ON public.coloring_v2_assets
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS coloring_v2_assets_book_kind_idx ON public.coloring_v2_assets(book_id, kind);

-- 9. Provider calls (audit trail — every model invocation)
CREATE TABLE IF NOT EXISTS public.coloring_v2_provider_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  step_id      uuid REFERENCES public.coloring_v2_steps(id) ON DELETE SET NULL,
  provider     text NOT NULL,
  model        text NOT NULL,
  purpose      text NOT NULL,
  prompt_version text,
  seed         bigint,
  input_hash   text,
  output_hash  text,
  latency_ms   int,
  cost_usd     numeric NOT NULL DEFAULT 0,
  success      boolean NOT NULL DEFAULT true,
  error_message text,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.coloring_v2_provider_calls TO authenticated;
GRANT ALL ON public.coloring_v2_provider_calls TO service_role;
ALTER TABLE public.coloring_v2_provider_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 provider calls admin all" ON public.coloring_v2_provider_calls
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS coloring_v2_provider_calls_book_idx ON public.coloring_v2_provider_calls(book_id);

-- 10. QC runs + findings + repairs
CREATE TABLE IF NOT EXISTS public.coloring_v2_qc_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  scope        text NOT NULL, -- full|cover|page|pdf_verify
  page_number  int,
  status       text NOT NULL DEFAULT 'running',
  overall_score numeric,
  typography_score numeric,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_qc_runs TO authenticated;
GRANT ALL ON public.coloring_v2_qc_runs TO service_role;
ALTER TABLE public.coloring_v2_qc_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 qc runs admin all" ON public.coloring_v2_qc_runs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.coloring_v2_qc_findings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_run_id    uuid NOT NULL REFERENCES public.coloring_v2_qc_runs(id) ON DELETE CASCADE,
  book_id      uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  page_number  int,
  rule_id      text NOT NULL,
  severity     text NOT NULL, -- info|warn|fail|critical
  measured     jsonb NOT NULL DEFAULT '{}'::jsonb,
  threshold    jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_path text,
  repair_action text,
  retry_count  int NOT NULL DEFAULT 0,
  verified     boolean,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_qc_findings TO authenticated;
GRANT ALL ON public.coloring_v2_qc_findings TO service_role;
ALTER TABLE public.coloring_v2_qc_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 qc findings admin all" ON public.coloring_v2_qc_findings
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS coloring_v2_qc_findings_book_idx ON public.coloring_v2_qc_findings(book_id);

CREATE TABLE IF NOT EXISTS public.coloring_v2_repairs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  finding_id   uuid REFERENCES public.coloring_v2_qc_findings(id) ON DELETE SET NULL,
  page_number  int,
  strategy     text NOT NULL, -- inpaint|regen_page|regen_title_layer|manual
  before_asset_id uuid REFERENCES public.coloring_v2_assets(id) ON DELETE SET NULL,
  after_asset_id  uuid REFERENCES public.coloring_v2_assets(id) ON DELETE SET NULL,
  success      boolean,
  cost_usd     numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_repairs TO authenticated;
GRANT ALL ON public.coloring_v2_repairs TO service_role;
ALTER TABLE public.coloring_v2_repairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 repairs admin all" ON public.coloring_v2_repairs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 11. PDF artifacts
CREATE TABLE IF NOT EXISTS public.coloring_v2_pdf_artifacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id      uuid NOT NULL REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  sha256       text,
  page_count   int,
  size_bytes   bigint,
  is_final     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_pdf_artifacts TO authenticated;
GRANT ALL ON public.coloring_v2_pdf_artifacts TO service_role;
ALTER TABLE public.coloring_v2_pdf_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 pdf artifacts admin all" ON public.coloring_v2_pdf_artifacts
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 12. Storefront packages (draft copy — NOT public until publish_status=published)
CREATE TABLE IF NOT EXISTS public.coloring_v2_storefront_packages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id             uuid NOT NULL UNIQUE REFERENCES public.coloring_v2_books(id) ON DELETE CASCADE,
  product_title       text,
  product_subtitle    text,
  hook                text,
  short_description   text,
  long_description    text,
  parent_benefits     text,
  page_count_verified int,
  age_tags            text[],
  theme_tags          text[],
  keywords            text[],
  suggested_price_usd numeric,
  cover_thumb_path    text,
  preview_paths       text[],
  series_suggestions  text[],
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coloring_v2_storefront_packages TO authenticated;
GRANT ALL ON public.coloring_v2_storefront_packages TO service_role;
ALTER TABLE public.coloring_v2_storefront_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2 storefront admin all" ON public.coloring_v2_storefront_packages
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at trigger reuse (public.set_updated_at already exists)
DROP TRIGGER IF EXISTS trg_v2_books_updated_at ON public.coloring_v2_books;
CREATE TRIGGER trg_v2_books_updated_at BEFORE UPDATE ON public.coloring_v2_books
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_v2_storefront_updated_at ON public.coloring_v2_storefront_packages;
CREATE TRIGGER trg_v2_storefront_updated_at BEFORE UPDATE ON public.coloring_v2_storefront_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Storage bucket policies for coloring-v2 (bucket already created)
-- Admin-only read/write of objects in bucket 'coloring-v2'.
-- ============================================================
CREATE POLICY "v2 storage admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coloring-v2' AND public.has_role(auth.uid(),'admin'));

CREATE POLICY "v2 storage admin write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'coloring-v2' AND public.has_role(auth.uid(),'admin'));

CREATE POLICY "v2 storage admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'coloring-v2' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'coloring-v2' AND public.has_role(auth.uid(),'admin'));

CREATE POLICY "v2 storage admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'coloring-v2' AND public.has_role(auth.uid(),'admin'));
