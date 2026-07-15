
CREATE TABLE IF NOT EXISTS public.production_slowdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_kids_id uuid,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  concept_at timestamptz,
  live_at timestamptz,
  total_minutes numeric(10,2) NOT NULL,
  sla_minutes integer NOT NULL DEFAULT 90,
  slowest_stage text,
  slowest_stage_minutes numeric(10,2),
  watchdog_rescues integer NOT NULL DEFAULT 0,
  stage_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text
);
GRANT ALL ON public.production_slowdowns TO service_role;
ALTER TABLE public.production_slowdowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slowdowns admin read"
  ON public.production_slowdowns FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS production_slowdowns_created_idx
  ON public.production_slowdowns (created_at DESC);
CREATE INDEX IF NOT EXISTS production_slowdowns_ebook_idx
  ON public.production_slowdowns (ebook_kids_id);

CREATE OR REPLACE FUNCTION public.kids_cycle_stats(p_days integer DEFAULT 30)
RETURNS TABLE(
  n_live bigint,
  p50_min numeric,
  p90_min numeric,
  min_min numeric,
  max_min numeric,
  n_sla_breach bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lived AS (
    SELECT ek.id,
           ek.created_at,
           (SELECT min(r.completed_at)
              FROM public.autopilot_kids_runs r
             WHERE r.ebook_kids_id = ek.id
               AND r.status = 'completed'
               AND r.current_step_label ILIKE '%publish%') AS live_at
      FROM public.ebooks_kids ek
     WHERE ek.ever_live = true
       AND ek.created_at >= now() - make_interval(days => p_days)
  ), m AS (
    SELECT EXTRACT(EPOCH FROM (live_at - created_at))/60 AS minutes
      FROM lived
     WHERE live_at IS NOT NULL
  )
  SELECT count(*)::bigint AS n_live,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)::numeric, 1) AS p50_min,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes)::numeric, 1) AS p90_min,
         round(min(minutes)::numeric, 1) AS min_min,
         round(max(minutes)::numeric, 1) AS max_min,
         count(*) FILTER (WHERE minutes > 90)::bigint AS n_sla_breach
    FROM m;
$$;

GRANT EXECUTE ON FUNCTION public.kids_cycle_stats(integer) TO service_role, authenticated;
