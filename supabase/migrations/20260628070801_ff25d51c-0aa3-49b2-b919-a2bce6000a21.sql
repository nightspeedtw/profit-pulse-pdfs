
CREATE TABLE IF NOT EXISTS public.autopilot_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id uuid,
  idea_id uuid,
  status text NOT NULL DEFAULT 'starting',
  current_step text,
  current_step_label text,
  current_action_message text,
  progress_percent int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  admin_needed_reason text,
  error_message text,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid,
  test_mode boolean NOT NULL DEFAULT false,
  pause_requested boolean NOT NULL DEFAULT false,
  mode text
);

CREATE INDEX IF NOT EXISTS autopilot_pipeline_runs_status_idx
  ON public.autopilot_pipeline_runs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_pipeline_runs_ebook_idx
  ON public.autopilot_pipeline_runs (ebook_id);

GRANT SELECT ON public.autopilot_pipeline_runs TO authenticated;
GRANT ALL ON public.autopilot_pipeline_runs TO service_role;
ALTER TABLE public.autopilot_pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read autopilot_pipeline_runs"
  ON public.autopilot_pipeline_runs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

CREATE TABLE IF NOT EXISTS public.autopilot_pipeline_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.autopilot_pipeline_runs(id) ON DELETE CASCADE,
  ebook_id uuid,
  step_order int NOT NULL,
  step_name text NOT NULL,
  step_label text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  message text,
  score numeric,
  required_score numeric,
  auto_fix_attempts int NOT NULL DEFAULT 0,
  max_auto_fix_attempts int NOT NULL DEFAULT 3,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms int,
  error_message text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_name)
);

CREATE INDEX IF NOT EXISTS autopilot_pipeline_steps_run_idx
  ON public.autopilot_pipeline_steps (run_id, step_order);

GRANT SELECT ON public.autopilot_pipeline_steps TO authenticated;
GRANT ALL ON public.autopilot_pipeline_steps TO service_role;
ALTER TABLE public.autopilot_pipeline_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read autopilot_pipeline_steps"
  ON public.autopilot_pipeline_steps FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_pipeline_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_pipeline_steps;
ALTER TABLE public.autopilot_pipeline_runs REPLICA IDENTITY FULL;
ALTER TABLE public.autopilot_pipeline_steps REPLICA IDENTITY FULL;
