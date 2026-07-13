
-- 1. kids_book_bibles
CREATE TABLE public.kids_book_bibles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ebook_id uuid NOT NULL UNIQUE REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  character_bible_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  style_bible_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  character_reference_image_url text,
  locked_at timestamptz,
  locked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kids_book_bibles TO authenticated;
GRANT ALL ON public.kids_book_bibles TO service_role;
ALTER TABLE public.kids_book_bibles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage kids_book_bibles"
  ON public.kids_book_bibles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_kids_book_bibles_updated_at
  BEFORE UPDATE ON public.kids_book_bibles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. qc_findings
CREATE TABLE public.qc_findings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ebook_id uuid NOT NULL,
  ebook_track text NOT NULL DEFAULT 'kids',
  run_id uuid,
  rule_id text NOT NULL,
  category text NOT NULL,
  page_number int,
  measured_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  threshold jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed boolean NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','major','minor')),
  evidence_url text,
  repair_action text,
  repair_attempts int NOT NULL DEFAULT 0,
  verification_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  qc_rule_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qc_findings_ebook_idx ON public.qc_findings(ebook_id);
CREATE INDEX qc_findings_rule_idx ON public.qc_findings(rule_id);
CREATE INDEX qc_findings_passed_idx ON public.qc_findings(ebook_id, passed);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_findings TO authenticated;
GRANT ALL ON public.qc_findings TO service_role;
ALTER TABLE public.qc_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage qc_findings"
  ON public.qc_findings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_qc_findings_updated_at
  BEFORE UPDATE ON public.qc_findings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. qc_rule_versions
CREATE TABLE public.qc_rule_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id text NOT NULL,
  version text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','major','minor')),
  threshold jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_rule_versions TO authenticated;
GRANT ALL ON public.qc_rule_versions TO service_role;
ALTER TABLE public.qc_rule_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage qc_rule_versions"
  ON public.qc_rule_versions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_qc_rule_versions_updated_at
  BEFORE UPDATE ON public.qc_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. ebooks_kids sellable columns
ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS sellable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overall_qc_score int,
  ADD COLUMN IF NOT EXISTS qc_rule_version text,
  ADD COLUMN IF NOT EXISTS human_review_reason text,
  ADD COLUMN IF NOT EXISTS qc_scorecard jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 5. autopilot_kids_runs sellable + pipeline_stage columns
ALTER TABLE public.autopilot_kids_runs
  ADD COLUMN IF NOT EXISTS sellable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pipeline_stage text,
  ADD COLUMN IF NOT EXISTS human_review_reason text;
