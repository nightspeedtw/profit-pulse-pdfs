-- Freeze + incident-queue + heartbeat scaffolding

-- 1) alert_log resolution fields
ALTER TABLE public.alert_log
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE INDEX IF NOT EXISTS alert_log_unresolved_idx
  ON public.alert_log (severity, created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS alert_log_dedupe_idx
  ON public.alert_log (dedupe_key)
  WHERE resolved_at IS NULL;

-- 2) System heartbeat table (single row per source)
CREATE TABLE IF NOT EXISTS public.system_heartbeat (
  source text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.system_heartbeat TO authenticated, anon;
GRANT ALL ON public.system_heartbeat TO service_role;
ALTER TABLE public.system_heartbeat ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read heartbeat"
  ON public.system_heartbeat FOR SELECT
  USING (true);

-- 3) Seed autopilot_frozen platform setting = true (FREEZE NOW per owner order)
INSERT INTO public.platform_settings (key, value_json)
VALUES ('autopilot_frozen', jsonb_build_object('frozen', true, 'set_at', now()::text, 'reason', 'owner_freeze_order'))
ON CONFLICT (key) DO UPDATE
  SET value_json = jsonb_build_object('frozen', true, 'set_at', now()::text, 'reason', 'owner_freeze_order');
