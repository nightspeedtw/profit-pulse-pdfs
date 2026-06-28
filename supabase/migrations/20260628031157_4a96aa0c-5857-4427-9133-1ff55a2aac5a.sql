
DO $$ BEGIN
  CREATE TYPE public.pipeline_status AS ENUM (
    'idea_generated','title_copywriting','outline_generation','writing','chapter_qc',
    'pdf_design','cover_design','product_copy','final_qc','shopify_draft','published','rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.market_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  source TEXT, topic TEXT,
  research_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  trend_score INTEGER CHECK (trend_score BETWEEN 0 AND 100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_intelligence TO authenticated;
GRANT ALL ON public.market_intelligence TO service_role;
ALTER TABLE public.market_intelligence ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage market_intelligence" ON public.market_intelligence
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_market_intelligence_created_at ON public.market_intelligence(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_category ON public.market_intelligence(category_id);
DROP TRIGGER IF EXISTS trg_market_intelligence_updated_at ON public.market_intelligence;
CREATE TRIGGER trg_market_intelligence_updated_at BEFORE UPDATE ON public.market_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ebook_ideas
  ADD COLUMN IF NOT EXISTS market_intelligence_id UUID REFERENCES public.market_intelligence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outline JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS research_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline_status public.pipeline_status NOT NULL DEFAULT 'idea_generated';
CREATE INDEX IF NOT EXISTS idx_ebook_ideas_pipeline_status ON public.ebook_ideas(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_ebook_ideas_status ON public.ebook_ideas(status);
CREATE INDEX IF NOT EXISTS idx_ebook_ideas_created_at ON public.ebook_ideas(created_at DESC);

ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS pipeline_status public.pipeline_status NOT NULL DEFAULT 'idea_generated',
  ADD COLUMN IF NOT EXISTS outline JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS memory_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS visual_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS product_copy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS buyer_appeal_score INTEGER CHECK (buyer_appeal_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS premium_score INTEGER CHECK (premium_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS hard_sell_strength_score INTEGER CHECK (hard_sell_strength_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS content_depth_score INTEGER CHECK (content_depth_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS cover_score INTEGER CHECK (cover_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS pdf_layout_score INTEGER CHECK (pdf_layout_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS compliance_safety_score INTEGER CHECK (compliance_safety_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS final_quality_score INTEGER CHECK (final_quality_score BETWEEN 0 AND 100);
CREATE INDEX IF NOT EXISTS idx_ebooks_pipeline_status ON public.ebooks(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_ebooks_status ON public.ebooks(status);
CREATE INDEX IF NOT EXISTS idx_ebooks_created_at ON public.ebooks(created_at DESC);

CREATE TABLE IF NOT EXISTS public.production_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID REFERENCES public.ebooks(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES public.ebook_ideas(id) ON DELETE CASCADE,
  pipeline_status public.pipeline_status NOT NULL DEFAULT 'idea_generated',
  priority INTEGER NOT NULL DEFAULT 100,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_queue TO authenticated;
GRANT ALL ON public.production_queue TO service_role;
ALTER TABLE public.production_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage production_queue" ON public.production_queue
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_production_queue_status ON public.production_queue(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_production_queue_priority ON public.production_queue(priority DESC, scheduled_at ASC);
CREATE INDEX IF NOT EXISTS idx_production_queue_scheduled_at ON public.production_queue(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_production_queue_ebook ON public.production_queue(ebook_id);
DROP TRIGGER IF EXISTS trg_production_queue_updated_at ON public.production_queue;
CREATE TRIGGER trg_production_queue_updated_at BEFORE UPDATE ON public.production_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.ebook_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID NOT NULL REFERENCES public.ebooks(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  brief TEXT, content TEXT, word_count INTEGER,
  pipeline_status public.pipeline_status NOT NULL DEFAULT 'writing',
  rewrite_count INTEGER NOT NULL DEFAULT 0,
  qc_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ebook_id, chapter_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebook_chapters TO authenticated;
GRANT ALL ON public.ebook_chapters TO service_role;
ALTER TABLE public.ebook_chapters ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage ebook_chapters" ON public.ebook_chapters
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_ebook_chapters_ebook_id ON public.ebook_chapters(ebook_id);
CREATE INDEX IF NOT EXISTS idx_ebook_chapters_status ON public.ebook_chapters(pipeline_status);
DROP TRIGGER IF EXISTS trg_ebook_chapters_updated_at ON public.ebook_chapters;
CREATE TRIGGER trg_ebook_chapters_updated_at BEFORE UPDATE ON public.ebook_chapters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.ebook_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID NOT NULL REFERENCES public.ebooks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  storage_path TEXT, url TEXT, mime_type TEXT, byte_size BIGINT,
  visual_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebook_assets TO authenticated;
GRANT ALL ON public.ebook_assets TO service_role;
ALTER TABLE public.ebook_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage ebook_assets" ON public.ebook_assets
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_ebook_assets_ebook_id ON public.ebook_assets(ebook_id);
CREATE INDEX IF NOT EXISTS idx_ebook_assets_kind ON public.ebook_assets(kind);
DROP TRIGGER IF EXISTS trg_ebook_assets_updated_at ON public.ebook_assets;
CREATE TRIGGER trg_ebook_assets_updated_at BEFORE UPDATE ON public.ebook_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.qc_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID REFERENCES public.ebooks(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES public.ebook_ideas(id) ON DELETE CASCADE,
  chapter_id UUID REFERENCES public.ebook_chapters(id) ON DELETE CASCADE,
  stage public.pipeline_status NOT NULL,
  buyer_appeal_score INTEGER CHECK (buyer_appeal_score BETWEEN 0 AND 100),
  premium_score INTEGER CHECK (premium_score BETWEEN 0 AND 100),
  hard_sell_strength_score INTEGER CHECK (hard_sell_strength_score BETWEEN 0 AND 100),
  content_depth_score INTEGER CHECK (content_depth_score BETWEEN 0 AND 100),
  cover_score INTEGER CHECK (cover_score BETWEEN 0 AND 100),
  pdf_layout_score INTEGER CHECK (pdf_layout_score BETWEEN 0 AND 100),
  compliance_safety_score INTEGER CHECK (compliance_safety_score BETWEEN 0 AND 100),
  final_quality_score INTEGER CHECK (final_quality_score BETWEEN 0 AND 100),
  passed BOOLEAN,
  raw_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_reports TO authenticated;
GRANT ALL ON public.qc_reports TO service_role;
ALTER TABLE public.qc_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage qc_reports" ON public.qc_reports
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_qc_reports_ebook ON public.qc_reports(ebook_id);
CREATE INDEX IF NOT EXISTS idx_qc_reports_stage ON public.qc_reports(stage);
CREATE INDEX IF NOT EXISTS idx_qc_reports_created_at ON public.qc_reports(created_at DESC);
DROP TRIGGER IF EXISTS trg_qc_reports_updated_at ON public.qc_reports;
CREATE TRIGGER trg_qc_reports_updated_at BEFORE UPDATE ON public.qc_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.automation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, description TEXT,
  cron_expression TEXT,
  scheduled_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_schedules TO authenticated;
GRANT ALL ON public.automation_schedules TO service_role;
ALTER TABLE public.automation_schedules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage automation_schedules" ON public.automation_schedules
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_automation_schedules_next_run ON public.automation_schedules(next_run_at);
CREATE INDEX IF NOT EXISTS idx_automation_schedules_scheduled_at ON public.automation_schedules(scheduled_at);
DROP TRIGGER IF EXISTS trg_automation_schedules_updated_at ON public.automation_schedules;
CREATE TRIGGER trg_automation_schedules_updated_at BEFORE UPDATE ON public.automation_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.shopify_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID REFERENCES public.ebooks(id) ON DELETE CASCADE,
  action TEXT NOT NULL, status TEXT NOT NULL,
  shopify_product_id TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_sync_logs TO authenticated;
GRANT ALL ON public.shopify_sync_logs TO service_role;
ALTER TABLE public.shopify_sync_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage shopify_sync_logs" ON public.shopify_sync_logs
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_shopify_sync_logs_ebook ON public.shopify_sync_logs(ebook_id);
CREATE INDEX IF NOT EXISTS idx_shopify_sync_logs_status ON public.shopify_sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_shopify_sync_logs_created_at ON public.shopify_sync_logs(created_at DESC);
DROP TRIGGER IF EXISTS trg_shopify_sync_logs_updated_at ON public.shopify_sync_logs;
CREATE TRIGGER trg_shopify_sync_logs_updated_at BEFORE UPDATE ON public.shopify_sync_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.api_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID REFERENCES public.ebooks(id) ON DELETE SET NULL,
  idea_id UUID REFERENCES public.ebook_ideas(id) ON DELETE SET NULL,
  provider TEXT NOT NULL, model TEXT, operation TEXT,
  stage public.pipeline_status,
  input_tokens INTEGER, output_tokens INTEGER,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  request_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_costs TO authenticated;
GRANT ALL ON public.api_costs TO service_role;
ALTER TABLE public.api_costs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "admins manage api_costs" ON public.api_costs
    FOR ALL TO authenticated
    USING (private.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_api_costs_ebook ON public.api_costs(ebook_id);
CREATE INDEX IF NOT EXISTS idx_api_costs_stage ON public.api_costs(stage);
CREATE INDEX IF NOT EXISTS idx_api_costs_created_at ON public.api_costs(created_at DESC);
