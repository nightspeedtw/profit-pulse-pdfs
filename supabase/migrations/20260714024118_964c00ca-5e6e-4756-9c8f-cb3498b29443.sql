CREATE TABLE IF NOT EXISTS public.pipeline_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  content_md text NOT NULL,
  source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','learned')),
  target_dimension text,
  age_band text,
  sort_index integer NOT NULL DEFAULT 100,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_key, version)
);

CREATE INDEX IF NOT EXISTS pipeline_skills_lookup_idx
  ON public.pipeline_skills (skill_key, version DESC);

GRANT SELECT ON public.pipeline_skills TO anon, authenticated;
GRANT ALL ON public.pipeline_skills TO service_role;

ALTER TABLE public.pipeline_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_skills readable" ON public.pipeline_skills;
CREATE POLICY "pipeline_skills readable"
  ON public.pipeline_skills FOR SELECT
  TO anon, authenticated
  USING (true);

DROP TRIGGER IF EXISTS pipeline_skills_updated_at ON public.pipeline_skills;
CREATE TRIGGER pipeline_skills_updated_at
  BEFORE UPDATE ON public.pipeline_skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();