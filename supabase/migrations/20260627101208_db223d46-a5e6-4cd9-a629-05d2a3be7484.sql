
-- Topic QC scores on ebook_ideas
ALTER TABLE public.ebook_ideas
  ADD COLUMN IF NOT EXISTS premium_score int,
  ADD COLUMN IF NOT EXISTS hard_sell_score int,
  ADD COLUMN IF NOT EXISTS commercial_intent_score int,
  ADD COLUMN IF NOT EXISTS clarity_score int,
  ADD COLUMN IF NOT EXISTS compliance_risk_score int,
  ADD COLUMN IF NOT EXISTS outline_structure_score int,
  ADD COLUMN IF NOT EXISTS outline_practical_score int,
  ADD COLUMN IF NOT EXISTS outline_buyer_score int,
  ADD COLUMN IF NOT EXISTS outline_depth_score int,
  ADD COLUMN IF NOT EXISTS outline_premium_score int,
  ADD COLUMN IF NOT EXISTS outline_duplicate_score int,
  ADD COLUMN IF NOT EXISTS topic_rewrite_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outline_rewrite_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_rejected_reason text;

-- Autopilot + QC fields on ebooks
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS chapter_qc jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS editorial_qc jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS product_page_qc jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_quality_score int,
  ADD COLUMN IF NOT EXISTS conversion_score int,
  ADD COLUMN IF NOT EXISTS compliance_safety_score int,
  ADD COLUMN IF NOT EXISTS shopify_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS autopilot_mode text NOT NULL DEFAULT 'safe',
  ADD COLUMN IF NOT EXISTS autopilot_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS needs_review_reason text,
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS product_copy jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Autopilot run log
CREATE TABLE IF NOT EXISTS public.autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id uuid REFERENCES public.ebooks(id) ON DELETE CASCADE,
  idea_id uuid REFERENCES public.ebook_ideas(id) ON DELETE CASCADE,
  step text NOT NULL,
  status text NOT NULL,
  score int,
  rewrite_count int NOT NULL DEFAULT 0,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  duration_ms int,
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.autopilot_runs TO authenticated;
GRANT ALL ON public.autopilot_runs TO service_role;

ALTER TABLE public.autopilot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all autopilot runs" ON public.autopilot_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_autopilot_runs_ebook ON public.autopilot_runs(ebook_id);
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_idea ON public.autopilot_runs(idea_id);
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_step ON public.autopilot_runs(step);
CREATE INDEX IF NOT EXISTS idx_ebooks_autopilot_state ON public.ebooks(autopilot_state);
