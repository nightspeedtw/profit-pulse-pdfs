
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove prior schedule if present, then re-add
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebook-autopilot-hourly') THEN
    PERFORM cron.unschedule('ebook-autopilot-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'ebook-autopilot-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://atccyjuwimibyoocpiwi.supabase.co/functions/v1/daily-cron',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Y2N5anV3aW1pYnlvb2NwaXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzY1OTUsImV4cCI6MjA5ODExMjU5NX0.vicBQdH2N2eMRBzIhui8tVcHhxEOqIJRB1md656njR8"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);
