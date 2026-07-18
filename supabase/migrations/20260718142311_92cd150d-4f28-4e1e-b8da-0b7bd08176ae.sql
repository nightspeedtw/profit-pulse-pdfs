
CREATE TABLE IF NOT EXISTS public.self_audit_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL,
  check_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
  defect_class TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  affected_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_self_audit_findings_run ON public.self_audit_findings(run_id, severity);
CREATE INDEX IF NOT EXISTS idx_self_audit_findings_class ON public.self_audit_findings(defect_class, created_at DESC);
GRANT SELECT ON public.self_audit_findings TO authenticated;
GRANT ALL ON public.self_audit_findings TO service_role;
ALTER TABLE public.self_audit_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self_audit_findings admin read" ON public.self_audit_findings
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
