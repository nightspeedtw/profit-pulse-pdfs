
-- =============== settings (single row) ===============
CREATE TABLE IF NOT EXISTS public.seo_autopilot_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  emergency_stop boolean NOT NULL DEFAULT false,
  publish_mode text NOT NULL DEFAULT 'draft_first'
    CHECK (publish_mode IN ('off','draft_first','auto_publish_when_passed')),
  max_public_pages_per_day int NOT NULL DEFAULT 3,
  max_draft_pages_per_day int NOT NULL DEFAULT 10,
  max_blog_posts_per_day int NOT NULL DEFAULT 1,
  max_programmatic_pages_per_day int NOT NULL DEFAULT 2,
  require_human_review_for_new_keyword_clusters boolean NOT NULL DEFAULT true,
  target_markets jsonb NOT NULL DEFAULT '["US","UK","AU","CA"]'::jsonb,
  preferred_language text NOT NULL DEFAULT 'en',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.seo_autopilot_settings TO authenticated;
GRANT ALL    ON public.seo_autopilot_settings TO service_role;
ALTER TABLE public.seo_autopilot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY seo_settings_admin_all ON public.seo_autopilot_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.seo_autopilot_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- =============== keyword clusters ===============
CREATE TABLE IF NOT EXISTS public.seo_keyword_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key text UNIQUE NOT NULL,
  cluster_name text NOT NULL,
  search_intent text NOT NULL CHECK (search_intent IN
    ('transactional','commercial','informational','navigational','seasonal','competitor_comparison')),
  priority int NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','needs_review')),
  source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','admin','competitor','generated')),
  primary_keyword text NOT NULL,
  secondary_keywords text[] NOT NULL DEFAULT '{}',
  competitor_keywords text[] NOT NULL DEFAULT '{}',
  negative_keywords text[] NOT NULL DEFAULT '{}',
  target_page_type text NOT NULL CHECK (target_page_type IN
    ('category','product','blog','guide','comparison','seasonal','programmatic')),
  min_word_count int NOT NULL DEFAULT 700,
  max_word_count int NOT NULL DEFAULT 1600,
  recommended_images int NOT NULL DEFAULT 5,
  aeo_questions text[] NOT NULL DEFAULT '{}',
  geo_evidence_points text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seo_clusters_status_priority_idx
  ON public.seo_keyword_clusters (status, priority DESC);
GRANT SELECT ON public.seo_keyword_clusters TO authenticated;
GRANT ALL    ON public.seo_keyword_clusters TO service_role;
ALTER TABLE public.seo_keyword_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY seo_clusters_admin_all ON public.seo_keyword_clusters
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============== content queue ===============
CREATE TABLE IF NOT EXISTS public.seo_content_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_cluster_id uuid REFERENCES public.seo_keyword_clusters(id) ON DELETE SET NULL,
  target_slug text,
  title text,
  meta_title text,
  meta_description text,
  page_type text NOT NULL DEFAULT 'blog',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','drafting','draft','qa_failed','approved','published','paused','rejected')),
  word_count int DEFAULT 0,
  image_count int DEFAULT 0,
  seo_score int DEFAULT 0,
  aeo_score int DEFAULT 0,
  geo_score int DEFAULT 0,
  duplicate_risk_score int DEFAULT 0,
  qa_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  body_md text,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seo_queue_status_idx ON public.seo_content_queue (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS seo_queue_slug_uidx ON public.seo_content_queue (target_slug)
  WHERE target_slug IS NOT NULL;
GRANT SELECT ON public.seo_content_queue TO authenticated;
GRANT ALL    ON public.seo_content_queue TO service_role;
ALTER TABLE public.seo_content_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY seo_queue_admin_all ON public.seo_content_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============== audit log ===============
CREATE TABLE IF NOT EXISTS public.seo_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity_type text,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seo_audit_log_created_idx ON public.seo_audit_log (created_at DESC);
GRANT SELECT ON public.seo_audit_log TO authenticated;
GRANT ALL    ON public.seo_audit_log TO service_role;
ALTER TABLE public.seo_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY seo_audit_admin_read ON public.seo_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- shared updated_at trigger
DROP TRIGGER IF EXISTS trg_seo_settings_updated_at ON public.seo_autopilot_settings;
CREATE TRIGGER trg_seo_settings_updated_at BEFORE UPDATE ON public.seo_autopilot_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_seo_clusters_updated_at ON public.seo_keyword_clusters;
CREATE TRIGGER trg_seo_clusters_updated_at BEFORE UPDATE ON public.seo_keyword_clusters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_seo_queue_updated_at ON public.seo_content_queue;
CREATE TRIGGER trg_seo_queue_updated_at BEFORE UPDATE ON public.seo_content_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
