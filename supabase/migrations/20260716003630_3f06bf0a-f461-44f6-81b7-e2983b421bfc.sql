
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kids_book_type') THEN
    CREATE TYPE public.kids_book_type AS ENUM ('picture_book','coloring_book');
  END IF;
END $$;

ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS book_type public.kids_book_type NOT NULL DEFAULT 'picture_book';

CREATE TABLE IF NOT EXISTS public.coloring_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text UNIQUE NOT NULL,
  category_name text NOT NULL,
  category_description text NOT NULL,
  target_age_min int NOT NULL,
  target_age_max int NOT NULL,
  allowed_subjects text[] NOT NULL DEFAULT '{}',
  allowed_supporting_elements text[] NOT NULL DEFAULT '{}',
  forbidden_subjects text[] NOT NULL DEFAULT '{}',
  line_art_style text NOT NULL,
  complexity_level text NOT NULL,
  background_complexity text NOT NULL,
  trim_size text NOT NULL DEFAULT '8.5x11',
  coloring_page_count int NOT NULL DEFAULT 32,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coloring_categories TO anon, authenticated;
GRANT ALL ON public.coloring_categories TO service_role;

ALTER TABLE public.coloring_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read coloring categories" ON public.coloring_categories;
CREATE POLICY "public read coloring categories"
  ON public.coloring_categories FOR SELECT USING (true);

DROP TRIGGER IF EXISTS coloring_categories_set_updated_at ON public.coloring_categories;
CREATE TRIGGER coloring_categories_set_updated_at
  BEFORE UPDATE ON public.coloring_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
