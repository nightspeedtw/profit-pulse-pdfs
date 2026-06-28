
ALTER TABLE public.generation_settings
  ADD COLUMN IF NOT EXISTS max_ai_calls_per_ebook INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_rewrite_attempts INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_shopify_uploads_per_day INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS cost_limit_reached BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cost_limit_reached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost_limit_reason TEXT;

CREATE TABLE IF NOT EXISTS public.pipeline_step_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id UUID REFERENCES public.ebooks(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES public.ebook_ideas(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  cost_estimate NUMERIC(10,4) NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.pipeline_step_logs TO authenticated;
GRANT ALL ON public.pipeline_step_logs TO service_role;

ALTER TABLE public.pipeline_step_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all pipeline_step_logs"
  ON public.pipeline_step_logs
  FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_pipeline_step_logs_ebook ON public.pipeline_step_logs(ebook_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_step_logs_status ON public.pipeline_step_logs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_step_logs_started ON public.pipeline_step_logs(started_at DESC);
