CREATE TABLE IF NOT EXISTS public.coloring_age_bands (
  key text PRIMARY KEY,
  label text NOT NULL,
  age_min integer NOT NULL,
  age_max integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coloring_age_bands TO anon, authenticated;
GRANT ALL ON public.coloring_age_bands TO service_role;
ALTER TABLE public.coloring_age_bands ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='coloring_age_bands' AND policyname='public read age bands') THEN
    CREATE POLICY "public read age bands" ON public.coloring_age_bands FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE public.coloring_categories ADD COLUMN IF NOT EXISTS age_band_key text REFERENCES public.coloring_age_bands(key);
ALTER TABLE public.coloring_categories ADD COLUMN IF NOT EXISTS seo_keywords jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.coloring_categories ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.coloring_categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;