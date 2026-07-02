-- Deduplicate autopilot_pipeline_runs: keep only the newest run per ebook_id.
-- Any older run for the same ebook becomes "superseded" so the UI does not
-- render the same ebook (and its cover) many times.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY ebook_id
           ORDER BY COALESCE(updated_at, started_at) DESC NULLS LAST, id DESC
         ) AS rn
    FROM public.autopilot_pipeline_runs
   WHERE ebook_id IS NOT NULL
)
UPDATE public.autopilot_pipeline_runs r
   SET status = 'superseded', updated_at = now()
  FROM ranked
 WHERE r.id = ranked.id
   AND ranked.rn > 1
   AND r.status NOT IN ('superseded','completed');

-- Trigger: whenever a NEW run is inserted for an ebook, mark all prior
-- non-terminal runs for that same ebook as superseded so at most one row
-- per ebook shows up as active/needs_admin/etc.
CREATE OR REPLACE FUNCTION public.supersede_prior_runs_per_ebook()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.ebook_id IS NOT NULL THEN
    UPDATE public.autopilot_pipeline_runs
       SET status = 'superseded', updated_at = now()
     WHERE ebook_id = NEW.ebook_id
       AND id <> NEW.id
       AND status NOT IN ('superseded','completed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supersede_prior_runs ON public.autopilot_pipeline_runs;
CREATE TRIGGER trg_supersede_prior_runs
AFTER INSERT ON public.autopilot_pipeline_runs
FOR EACH ROW EXECUTE FUNCTION public.supersede_prior_runs_per_ebook();