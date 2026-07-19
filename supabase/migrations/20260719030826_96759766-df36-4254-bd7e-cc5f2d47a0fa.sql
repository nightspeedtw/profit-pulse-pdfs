
-- Owner doctrine "quality_at_the_source" (2026-07-19).
-- Prevention stack: measure first-pass yield per (subject, scene_bucket, provider),
-- curate gold references per style_contract, park low-FPY combos to a practice
-- backlog, and expose views the page-planner + provider router consult before
-- any paid call.

CREATE TABLE IF NOT EXISTS public.page_fpy_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         UUID NOT NULL,
  page_number     INTEGER,
  call_class      TEXT NOT NULL DEFAULT 'coloring_interior',
  subject         TEXT,
  scene_bucket    TEXT,
  provider        TEXT NOT NULL,
  passed_first    BOOLEAN NOT NULL,
  fail_reasons    TEXT[],
  style_contract  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_page_fpy_events_lookup
  ON public.page_fpy_events (call_class, subject, scene_bucket, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_page_fpy_events_book ON public.page_fpy_events (book_id);
GRANT SELECT, INSERT ON public.page_fpy_events TO authenticated;
GRANT ALL ON public.page_fpy_events TO service_role;
ALTER TABLE public.page_fpy_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "svc write fpy events" ON public.page_fpy_events
  FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.gold_reference_pages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  style_contract_version  TEXT NOT NULL,
  subject                 TEXT,
  scene_bucket            TEXT,
  storage_bucket          TEXT NOT NULL DEFAULT 'ebook-covers',
  storage_path            TEXT NOT NULL,
  signed_url              TEXT,
  signed_url_expires_at   TIMESTAMPTZ,
  score                   NUMERIC,
  source_book_id          UUID,
  source_prompt           TEXT,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_gold_ref_pick
  ON public.gold_reference_pages (style_contract_version, subject, scene_bucket, active, score DESC);
GRANT SELECT, INSERT, UPDATE ON public.gold_reference_pages TO authenticated;
GRANT ALL ON public.gold_reference_pages TO service_role;
ALTER TABLE public.gold_reference_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin manages gold refs" ON public.gold_reference_pages
  FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.practice_backlog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       TEXT NOT NULL,
  scene_bucket  TEXT NOT NULL,
  provider      TEXT,
  fpy_pct       NUMERIC,
  sample_size   INTEGER,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'parked',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject, scene_bucket, provider)
);
GRANT SELECT, INSERT, UPDATE ON public.practice_backlog TO authenticated;
GRANT ALL ON public.practice_backlog TO service_role;
ALTER TABLE public.practice_backlog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin manages practice backlog" ON public.practice_backlog
  FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- FPY lookup views (30-day window; sample_size ≥ 5 required by callers)
CREATE OR REPLACE VIEW public.v_subject_scene_provider_fpy AS
  SELECT
    lower(coalesce(subject,'')) AS subject_key,
    lower(coalesce(scene_bucket,'')) AS scene_bucket,
    provider,
    call_class,
    count(*)::int AS attempts,
    sum(CASE WHEN passed_first THEN 1 ELSE 0 END)::int AS passes,
    ROUND(100.0 * sum(CASE WHEN passed_first THEN 1 ELSE 0 END) / NULLIF(count(*),0), 1) AS fpy_pct
  FROM public.page_fpy_events
  WHERE created_at >= now() - interval '30 days'
  GROUP BY 1,2,3,4;
GRANT SELECT ON public.v_subject_scene_provider_fpy TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_call_class_provider_fpy AS
  SELECT
    call_class,
    provider,
    count(*)::int AS attempts,
    sum(CASE WHEN passed_first THEN 1 ELSE 0 END)::int AS passes,
    ROUND(100.0 * sum(CASE WHEN passed_first THEN 1 ELSE 0 END) / NULLIF(count(*),0), 1) AS fpy_pct
  FROM public.page_fpy_events
  WHERE created_at >= now() - interval '14 days'
  GROUP BY 1,2;
GRANT SELECT ON public.v_call_class_provider_fpy TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_book_fpy AS
  SELECT
    book_id,
    call_class,
    count(*)::int AS pages,
    sum(CASE WHEN passed_first THEN 1 ELSE 0 END)::int AS first_pass_pages,
    ROUND(100.0 * sum(CASE WHEN passed_first THEN 1 ELSE 0 END) / NULLIF(count(*),0), 1) AS fpy_pct,
    min(created_at) AS first_event_at,
    max(created_at) AS last_event_at
  FROM public.page_fpy_events
  GROUP BY 1,2;
GRANT SELECT ON public.v_book_fpy TO authenticated, service_role;
