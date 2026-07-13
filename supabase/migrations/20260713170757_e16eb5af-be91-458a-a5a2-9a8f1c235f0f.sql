ALTER TABLE public.autopilot_kids_runs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_kids_runs;