
-- ============================================================================
-- Phase 1: Blog CMS Editorial Foundation
-- ============================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.blog_content_status AS ENUM (
    'draft','ai_generated','needs_fact_check','needs_human_review',
    'approved','scheduled','published','needs_update','archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.blog_decay_status AS ENUM (
    'stable','growing','declining','needs_refresh','needs_rewrite',
    'merge_candidate','redirect_candidate','remove_candidate'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 1. blog_authors
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  full_name text NOT NULL,
  photo_url text,
  job_title text,
  biography text,
  experience text,
  expertise text[] DEFAULT '{}',
  social_links jsonb DEFAULT '{}'::jsonb,
  author_page_url text,
  disclosure text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_authors TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_authors TO authenticated;
GRANT ALL ON public.blog_authors TO service_role;
ALTER TABLE public.blog_authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active authors" ON public.blog_authors
  FOR SELECT USING (active = true);
CREATE POLICY "admin manage authors" ON public.blog_authors
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER blog_authors_touch BEFORE UPDATE ON public.blog_authors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. blog_reviewers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_reviewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  full_name text NOT NULL,
  credentials text,
  photo_url text,
  bio text,
  social_links jsonb DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_reviewers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_reviewers TO authenticated;
GRANT ALL ON public.blog_reviewers TO service_role;
ALTER TABLE public.blog_reviewers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active reviewers" ON public.blog_reviewers
  FOR SELECT USING (active = true);
CREATE POLICY "admin manage reviewers" ON public.blog_reviewers
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER blog_reviewers_touch BEFORE UPDATE ON public.blog_reviewers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. blog_content_clusters
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_content_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key text NOT NULL UNIQUE,
  cluster_name text NOT NULL,
  description text,
  primary_keyword text,
  search_intent text,
  pillar_post_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_content_clusters TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_content_clusters TO authenticated;
GRANT ALL ON public.blog_content_clusters TO service_role;
ALTER TABLE public.blog_content_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active clusters" ON public.blog_content_clusters
  FOR SELECT USING (active = true);
CREATE POLICY "admin manage clusters" ON public.blog_content_clusters
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER blog_clusters_touch BEFORE UPDATE ON public.blog_content_clusters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. blog_redirects (301 manager)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_path text NOT NULL UNIQUE,
  to_path text NOT NULL,
  status_code int NOT NULL DEFAULT 301,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.blog_redirects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_redirects TO authenticated;
GRANT ALL ON public.blog_redirects TO service_role;
ALTER TABLE public.blog_redirects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active redirects" ON public.blog_redirects
  FOR SELECT USING (active = true);
CREATE POLICY "admin manage redirects" ON public.blog_redirects
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER blog_redirects_touch BEFORE UPDATE ON public.blog_redirects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. Extend blog_posts
-- ============================================================================
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS search_intent text,
  ADD COLUMN IF NOT EXISTS funnel_stage text,
  ADD COLUMN IF NOT EXISTS target_audience text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS cluster_id uuid REFERENCES public.blog_content_clusters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_pillar_id uuid REFERENCES public.blog_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS semantic_keywords text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS long_tail_questions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS entities text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS competing_urls text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cannibalization_risk text,
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.blog_authors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewer_id uuid REFERENCES public.blog_reviewers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS reading_time_min int,
  ADD COLUMN IF NOT EXISTS content_score int,
  ADD COLUMN IF NOT EXISTS word_count_target_min int,
  ADD COLUMN IF NOT EXISTS word_count_target_max int,
  ADD COLUMN IF NOT EXISTS direct_answer text,
  ADD COLUMN IF NOT EXISTS takeaways text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sources jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS internal_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS og_image text,
  ADD COLUMN IF NOT EXISTS twitter_image text,
  ADD COLUMN IF NOT EXISTS robots text DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS noindex boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS redirects_to text,
  ADD COLUMN IF NOT EXISTS article_section text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS toc_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS decay_status public.blog_decay_status,
  ADD COLUMN IF NOT EXISTS content_status public.blog_content_status;

-- Backfill content_status from legacy `status`
UPDATE public.blog_posts
   SET content_status = CASE
     WHEN status = 'published' THEN 'published'::public.blog_content_status
     WHEN status = 'draft'     THEN 'draft'::public.blog_content_status
     WHEN status = 'archived'  THEN 'archived'::public.blog_content_status
     WHEN status = 'scheduled' THEN 'scheduled'::public.blog_content_status
     ELSE 'draft'::public.blog_content_status
   END
 WHERE content_status IS NULL;

-- Backfill last_updated_at from updated_at
UPDATE public.blog_posts
   SET last_updated_at = COALESCE(last_updated_at, updated_at);

-- Uniqueness on SEO-critical fields for published posts
CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug_unique_published
  ON public.blog_posts (slug)
  WHERE content_status = 'published' OR status = 'published';

CREATE INDEX IF NOT EXISTS blog_posts_cluster_idx ON public.blog_posts (cluster_id);
CREATE INDEX IF NOT EXISTS blog_posts_pillar_idx ON public.blog_posts (parent_pillar_id);
CREATE INDEX IF NOT EXISTS blog_posts_content_status_idx ON public.blog_posts (content_status);
CREATE INDEX IF NOT EXISTS blog_posts_primary_keyword_idx ON public.blog_posts (lower(primary_keyword));

-- pillar_post_id FK on clusters — added after blog_posts exists
ALTER TABLE public.blog_content_clusters
  DROP CONSTRAINT IF EXISTS blog_clusters_pillar_fk;
ALTER TABLE public.blog_content_clusters
  ADD CONSTRAINT blog_clusters_pillar_fk
  FOREIGN KEY (pillar_post_id) REFERENCES public.blog_posts(id) ON DELETE SET NULL;

-- ============================================================================
-- 6. blog_revisions (version history + rollback)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  revision_number int NOT NULL,
  snapshot jsonb NOT NULL,
  editor_id uuid,
  editor_label text,
  change_note text,
  content_score int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, revision_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_revisions TO authenticated;
GRANT ALL ON public.blog_revisions TO service_role;
ALTER TABLE public.blog_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read revisions" ON public.blog_revisions
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admin write revisions" ON public.blog_revisions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS blog_revisions_post_idx ON public.blog_revisions (post_id, revision_number DESC);

-- ============================================================================
-- 7. blog_internal_link_suggestions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_internal_link_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  target_slug text NOT NULL,
  target_url text,
  anchor_text text NOT NULL,
  relevance_score numeric(5,2),
  reason text,
  accepted boolean NOT NULL DEFAULT false,
  inserted_at_paragraph int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_internal_link_suggestions TO authenticated;
GRANT ALL ON public.blog_internal_link_suggestions TO service_role;
ALTER TABLE public.blog_internal_link_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read link suggestions" ON public.blog_internal_link_suggestions
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admin write link suggestions" ON public.blog_internal_link_suggestions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS blog_link_sugg_post_idx ON public.blog_internal_link_suggestions (post_id);

-- ============================================================================
-- 8. blog_qa_findings
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_qa_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  check_name text NOT NULL,
  severity text NOT NULL,
  category text,
  message text NOT NULL,
  evidence jsonb DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_qa_findings TO authenticated;
GRANT ALL ON public.blog_qa_findings TO service_role;
ALTER TABLE public.blog_qa_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read qa findings" ON public.blog_qa_findings
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admin write qa findings" ON public.blog_qa_findings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS blog_qa_post_idx ON public.blog_qa_findings (post_id, resolved);

-- ============================================================================
-- 9. blog_decay_metrics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.blog_decay_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  impressions int DEFAULT 0,
  clicks int DEFAULT 0,
  ctr numeric(6,4),
  avg_position numeric(6,2),
  indexed boolean,
  traffic_change_pct numeric(7,2),
  conversions int DEFAULT 0,
  broken_link_count int DEFAULT 0,
  decay_status public.blog_decay_status,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, metric_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_decay_metrics TO authenticated;
GRANT ALL ON public.blog_decay_metrics TO service_role;
ALTER TABLE public.blog_decay_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read decay metrics" ON public.blog_decay_metrics
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admin write decay metrics" ON public.blog_decay_metrics
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS blog_decay_post_date_idx ON public.blog_decay_metrics (post_id, metric_date DESC);

-- ============================================================================
-- touch trigger on blog_posts.updated_at (only if not present)
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'blog_posts_touch'
  ) THEN
    CREATE TRIGGER blog_posts_touch BEFORE UPDATE ON public.blog_posts
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
