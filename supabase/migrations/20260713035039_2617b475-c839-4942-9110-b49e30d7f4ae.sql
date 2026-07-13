
-- 1. Age groups
CREATE TABLE public.kids_age_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label_th text NOT NULL,
  label_en text NOT NULL,
  min_age int NOT NULL,
  max_age int NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kids_age_groups TO anon, authenticated;
GRANT ALL ON public.kids_age_groups TO service_role;
ALTER TABLE public.kids_age_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read age groups" ON public.kids_age_groups FOR SELECT USING (true);

-- 2. Themes
CREATE TABLE public.kids_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label_th text NOT NULL,
  label_en text NOT NULL,
  icon_name text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kids_themes TO anon, authenticated;
GRANT ALL ON public.kids_themes TO service_role;
ALTER TABLE public.kids_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read themes" ON public.kids_themes FOR SELECT USING (true);

-- 3. Book series
CREATE TABLE public.book_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  cover_image_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.book_series TO anon, authenticated;
GRANT ALL ON public.book_series TO service_role;
ALTER TABLE public.book_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read series" ON public.book_series FOR SELECT USING (true);
CREATE TRIGGER book_series_set_updated_at BEFORE UPDATE ON public.book_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Join tables
CREATE TABLE public.ebook_kids_ages (
  ebook_id uuid NOT NULL REFERENCES public.ebooks(id) ON DELETE CASCADE,
  age_group_id uuid NOT NULL REFERENCES public.kids_age_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ebook_id, age_group_id)
);
GRANT SELECT ON public.ebook_kids_ages TO anon, authenticated;
GRANT ALL ON public.ebook_kids_ages TO service_role;
ALTER TABLE public.ebook_kids_ages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read ebook ages" ON public.ebook_kids_ages FOR SELECT USING (true);
CREATE INDEX idx_ebook_kids_ages_age ON public.ebook_kids_ages(age_group_id);

CREATE TABLE public.ebook_kids_themes (
  ebook_id uuid NOT NULL REFERENCES public.ebooks(id) ON DELETE CASCADE,
  theme_id uuid NOT NULL REFERENCES public.kids_themes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ebook_id, theme_id)
);
GRANT SELECT ON public.ebook_kids_themes TO anon, authenticated;
GRANT ALL ON public.ebook_kids_themes TO service_role;
ALTER TABLE public.ebook_kids_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read ebook themes" ON public.ebook_kids_themes FOR SELECT USING (true);
CREATE INDEX idx_ebook_kids_themes_theme ON public.ebook_kids_themes(theme_id);

-- 5. Extra columns on ebooks
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS is_bestseller boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.book_series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ebooks_series_id ON public.ebooks(series_id);
CREATE INDEX IF NOT EXISTS idx_ebooks_is_bestseller ON public.ebooks(is_bestseller) WHERE is_bestseller = true;

-- 6. Seed age groups
INSERT INTO public.kids_age_groups (slug, label_th, label_en, min_age, max_age, sort_order) VALUES
  ('0-3',  '0-3 ปี · บอร์ดบุ๊ค',        '0-3 · Board Books',        0,  3,  1),
  ('4-6',  '4-6 ปี · นิทานภาพ',         '4-6 · Picture Books',      4,  6,  2),
  ('7-9',  '7-9 ปี · วรรณกรรมตอนต้น',   '7-9 · Early Chapter',      7,  9,  3),
  ('9-12', '9-12 ปี · วรรณกรรมเยาวชน',  '9-12 · Middle Grade',      9,  12, 4),
  ('13+',  '13 ปีขึ้นไป · YA',          '13+ · Young Adult',        13, 99, 5)
ON CONFLICT (slug) DO NOTHING;

-- 7. Seed themes
INSERT INTO public.kids_themes (slug, label_th, label_en, icon_name, sort_order) VALUES
  ('bedtime',           'นิทานก่อนนอน',       'Bedtime Stories',        'Moon',      1),
  ('animals-nature',    'สัตว์และธรรมชาติ',    'Animals & Nature',       'PawPrint',  2),
  ('ef-life-skills',    'พัฒนาการ & ทักษะชีวิต','EF & Life Skills',      'Sparkles',  3),
  ('adventure-fantasy', 'ผจญภัย & แฟนตาซี',   'Adventure & Fantasy',    'Wand2',     4),
  ('friendship-family', 'มิตรภาพ & ครอบครัว', 'Friendship & Family',    'Users',     5),
  ('humor-fun',         'ตลก & สนุกสนาน',     'Humor & Fun',            'Laugh',     6),
  ('stem-educational',  'ความรู้ & วิทยาศาสตร์','STEM & Educational',    'Rocket',    7)
ON CONFLICT (slug) DO NOTHING;

-- 8. Backfill known kids books
DO $$
DECLARE
  age_46 uuid;
  th_bed uuid; th_adv uuid; th_ef uuid; th_fam uuid;
  b_nimble uuid; b_barnaby uuid;
BEGIN
  SELECT id INTO age_46 FROM public.kids_age_groups WHERE slug='4-6';
  SELECT id INTO th_bed FROM public.kids_themes WHERE slug='bedtime';
  SELECT id INTO th_adv FROM public.kids_themes WHERE slug='adventure-fantasy';
  SELECT id INTO th_ef  FROM public.kids_themes WHERE slug='ef-life-skills';
  SELECT id INTO th_fam FROM public.kids_themes WHERE slug='friendship-family';

  SELECT id INTO b_nimble FROM public.ebooks WHERE title ILIKE '%Nimble%' LIMIT 1;
  SELECT id INTO b_barnaby FROM public.ebooks WHERE title ILIKE '%Barnaby%' LIMIT 1;

  IF b_nimble IS NOT NULL AND age_46 IS NOT NULL THEN
    INSERT INTO public.ebook_kids_ages(ebook_id, age_group_id) VALUES (b_nimble, age_46) ON CONFLICT DO NOTHING;
    INSERT INTO public.ebook_kids_themes(ebook_id, theme_id) VALUES (b_nimble, th_adv), (b_nimble, th_ef) ON CONFLICT DO NOTHING;
  END IF;

  IF b_barnaby IS NOT NULL AND age_46 IS NOT NULL THEN
    INSERT INTO public.ebook_kids_ages(ebook_id, age_group_id) VALUES (b_barnaby, age_46) ON CONFLICT DO NOTHING;
    INSERT INTO public.ebook_kids_themes(ebook_id, theme_id) VALUES (b_barnaby, th_bed), (b_barnaby, th_fam) ON CONFLICT DO NOTHING;
  END IF;
END $$;
