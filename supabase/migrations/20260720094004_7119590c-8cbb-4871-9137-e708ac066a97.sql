
-- Story Batch V2: isolated additive 50-book batch production
-- All tables prefixed `story_batch_v2_`. Nothing here touches existing production.

CREATE TABLE public.story_batch_v2_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'batch-50-en',
  status TEXT NOT NULL DEFAULT 'queued',
    -- queued | preflight | portfolio_planning | pilot_running | full_running | paused | completed | blocked
  budget_usd_cents INTEGER NOT NULL DEFAULT 7500,
  repair_reserve_pct NUMERIC(5,2) NOT NULL DEFAULT 20.00,
  projected_cost_cents INTEGER,
  actual_cost_cents INTEGER NOT NULL DEFAULT 0,
  target_total INTEGER NOT NULL DEFAULT 50,
  targets_by_age JSONB NOT NULL DEFAULT
    '{"age_2_4":10,"age_4_6":10,"age_6_8":10,"age_8_12":10,"age_13_17":10}'::jsonb,
  language TEXT NOT NULL DEFAULT 'en',
  trim TEXT NOT NULL DEFAULT 'square_8_5',
  preflight_report JSONB,
  blocker_reason TEXT,
  paused BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.story_batch_v2_books (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.story_batch_v2_batches(id) ON DELETE CASCADE,
  age_band TEXT NOT NULL,  -- age_2_4 | age_4_6 | age_6_8 | age_8_12 | age_13_17
  slot_index INTEGER NOT NULL,
  is_pilot BOOLEAN NOT NULL DEFAULT false,

  -- concept
  title TEXT,
  subtitle TEXT,
  hook TEXT,
  synopsis TEXT,
  protagonist TEXT,
  setting TEXT,
  theme TEXT,
  keywords TEXT[],
  category_tags TEXT[],
  parent_value TEXT,
  concept_score NUMERIC(5,2),
  differentiation_note TEXT,

  -- planning
  story_bible JSONB,
  character_bible JSONB,
  style_bible JSONB,
  page_plan JSONB,
  manuscript_md TEXT,
  cover_brief JSONB,

  -- assets
  cover_url TEXT,
  cover_asset_id UUID,
  thumbnail_url TEXT,
  pdf_url TEXT,
  pdf_sha256 TEXT,
  pdf_page_count INTEGER,

  -- QC
  story_gate_score JSONB,
  final_qc_score JSONB,
  overall_qc_score NUMERIC(5,2),
  qc_verdict TEXT,     -- pending | pass | needs_repair | fail

  -- state
  stage TEXT NOT NULL DEFAULT 'queued',
    -- queued|preflight|concept_generation|story_planning|manuscript_generation|story_qc
    -- |character_reference|cover_generation|interior_generation|layout|pdf_validation
    -- |targeted_repair|final_pdf_ready|quota_wait|provider_wait|retired|failed_nonrecoverable
  stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stage_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sellable BOOLEAN NOT NULL DEFAULT false,
  cost_cents INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, age_band, slot_index)
);

CREATE INDEX story_batch_v2_books_batch_stage_idx
  ON public.story_batch_v2_books (batch_id, stage);
CREATE INDEX story_batch_v2_books_batch_age_idx
  ON public.story_batch_v2_books (batch_id, age_band);

CREATE TABLE public.story_batch_v2_cost_ledger (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.story_batch_v2_batches(id) ON DELETE CASCADE,
  book_id UUID REFERENCES public.story_batch_v2_books(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,        -- openai | google | runware | ...
  model TEXT NOT NULL,
  kind TEXT NOT NULL,            -- text | image_cover | image_interior | image_ref | other
  cost_cents INTEGER NOT NULL,
  units INTEGER,                 -- tokens or images
  meta JSONB,
  provider_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX story_batch_v2_cost_ledger_batch_idx
  ON public.story_batch_v2_cost_ledger (batch_id, created_at DESC);
CREATE INDEX story_batch_v2_cost_ledger_book_idx
  ON public.story_batch_v2_cost_ledger (book_id);

CREATE TABLE public.story_batch_v2_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES public.story_batch_v2_books(id) ON DELETE CASCADE,
  role TEXT NOT NULL,   -- character_ref | style_ref | cover_master | interior_scene | pdf | thumbnail
  page_number INTEGER,
  provider TEXT,
  model TEXT,
  quality TEXT,
  storage_path TEXT,
  public_url TEXT,
  sha256 TEXT,
  bytes INTEGER,
  meta JSONB,
  approved BOOLEAN NOT NULL DEFAULT false,
  superseded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX story_batch_v2_assets_book_role_idx
  ON public.story_batch_v2_assets (book_id, role, created_at DESC);

CREATE TABLE public.story_batch_v2_qc_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES public.story_batch_v2_books(id) ON DELETE CASCADE,
  gate TEXT NOT NULL,        -- concept | story | character | cover | interior | pdf | matter | final
  severity TEXT NOT NULL,    -- info | warn | critical
  code TEXT NOT NULL,
  message TEXT,
  page_number INTEGER,
  detail JSONB,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX story_batch_v2_qc_findings_book_idx
  ON public.story_batch_v2_qc_findings (book_id, gate);

-- updated_at triggers reuse existing set_updated_at()
CREATE TRIGGER story_batch_v2_batches_updated_at
  BEFORE UPDATE ON public.story_batch_v2_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER story_batch_v2_books_updated_at
  BEFORE UPDATE ON public.story_batch_v2_books
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Grants + RLS: admin read, service_role writes
GRANT SELECT ON public.story_batch_v2_batches       TO authenticated;
GRANT SELECT ON public.story_batch_v2_books         TO authenticated;
GRANT SELECT ON public.story_batch_v2_cost_ledger   TO authenticated;
GRANT SELECT ON public.story_batch_v2_assets        TO authenticated;
GRANT SELECT ON public.story_batch_v2_qc_findings   TO authenticated;
GRANT ALL ON public.story_batch_v2_batches       TO service_role;
GRANT ALL ON public.story_batch_v2_books         TO service_role;
GRANT ALL ON public.story_batch_v2_cost_ledger   TO service_role;
GRANT ALL ON public.story_batch_v2_assets        TO service_role;
GRANT ALL ON public.story_batch_v2_qc_findings   TO service_role;

ALTER TABLE public.story_batch_v2_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_batch_v2_books       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_batch_v2_cost_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_batch_v2_assets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_batch_v2_qc_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read batches"       ON public.story_batch_v2_batches
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read books"         ON public.story_batch_v2_books
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read cost ledger"   ON public.story_batch_v2_cost_ledger
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read assets"        ON public.story_batch_v2_assets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read qc findings"   ON public.story_batch_v2_qc_findings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
