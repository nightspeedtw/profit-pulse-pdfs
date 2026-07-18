CREATE TABLE IF NOT EXISTS public.alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_class text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','info')),
  title text NOT NULL,
  body text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_sent boolean NOT NULL DEFAULT false,
  email_message_id text,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_log_class_created ON public.alert_log(alert_class, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_log_created ON public.alert_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_log_severity_created ON public.alert_log(severity, created_at DESC);

GRANT SELECT ON public.alert_log TO authenticated;
GRANT ALL ON public.alert_log TO service_role;

ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read alert_log" ON public.alert_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));