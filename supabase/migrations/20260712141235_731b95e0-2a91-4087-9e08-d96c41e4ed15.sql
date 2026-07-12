
ALTER TABLE public.generation_settings
  ADD COLUMN IF NOT EXISTS tick_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stuck_run_ttl_min int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tick_result jsonb;

-- Reschedule: replace hourly daily-cron with 5-minute autopilot-tick.
-- Keep autopilot-recovery-worker as-is.
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname='ebook-autopilot-hourly';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  SELECT jobid INTO jid FROM cron.job WHERE jobname='autopilot-tick-5min';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'autopilot-tick-5min',
  '*/5 * * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://atccyjuwimibyoocpiwi.supabase.co/functions/v1/autopilot-tick',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Y2N5anV3aW1pYnlvb2NwaXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzY1OTUsImV4cCI6MjA5ODExMjU5NX0.vicBQdH2N2eMRBzIhui8tVcHhxEOqIJRB1md656njR8'
    ),
    body := jsonb_build_object('source','pg_cron','tick_at', now())
  );
  $CRON$
);

-- Also run a lighter daily housekeeping call to daily-cron once per day at 14:00 UTC (publish window).
SELECT cron.schedule(
  'daily-cron-housekeeping',
  '0 14 * * *',
  $CRON$
  SELECT net.http_post(
    url := 'https://atccyjuwimibyoocpiwi.supabase.co/functions/v1/daily-cron',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Y2N5anV3aW1pYnlvb2NwaXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzY1OTUsImV4cCI6MjA5ODExMjU5NX0.vicBQdH2N2eMRBzIhui8tVcHhxEOqIJRB1md656njR8'
    ),
    body := jsonb_build_object('source','pg_cron_daily')
  );
  $CRON$
);
