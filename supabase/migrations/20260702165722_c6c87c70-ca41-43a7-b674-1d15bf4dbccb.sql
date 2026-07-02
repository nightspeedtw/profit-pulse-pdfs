
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS canonical_status text,
  ADD COLUMN IF NOT EXISTS queue_position int,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_start_after_run_id uuid,
  ADD COLUMN IF NOT EXISTS waiting_reason text,
  ADD COLUMN IF NOT EXISTS current_step text,
  ADD COLUMN IF NOT EXISTS current_subtask text,
  ADD COLUMN IF NOT EXISTS progress_pct int,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_qc_score numeric,
  ADD COLUMN IF NOT EXISTS autofix_attempt int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS autofix_max int DEFAULT 3,
  ADD COLUMN IF NOT EXISTS structured_error jsonb;

CREATE INDEX IF NOT EXISTS ebooks_canonical_status_idx ON public.ebooks(canonical_status);
CREATE INDEX IF NOT EXISTS ebooks_queue_position_idx ON public.ebooks(queue_position) WHERE queue_position IS NOT NULL;
CREATE INDEX IF NOT EXISTS ebooks_last_heartbeat_at_idx ON public.ebooks(last_heartbeat_at);

CREATE TABLE IF NOT EXISTS public.system_fix_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  detected_problem text NOT NULL,
  root_cause text,
  error_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  affected_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_ebook_id uuid,
  affected_run_id uuid,
  required_fix text NOT NULL,
  acceptance_test text,
  lovable_prompt text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  occurrences int NOT NULL DEFAULT 1,
  fingerprint text UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_fix_instructions TO authenticated;
GRANT ALL ON public.system_fix_instructions TO service_role;

ALTER TABLE public.system_fix_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage system fixes"
  ON public.system_fix_instructions
  FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS system_fix_instructions_status_idx
  ON public.system_fix_instructions(status, last_seen_at DESC);

CREATE TRIGGER system_fix_instructions_updated_at
  BEFORE UPDATE ON public.system_fix_instructions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
