
ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS age_band       text,
  ADD COLUMN IF NOT EXISTS theme_slugs    text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS buyer_job_tags text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS ebooks_kids_age_band_idx    ON public.ebooks_kids (age_band);
CREATE INDEX IF NOT EXISTS ebooks_kids_theme_slugs_gin ON public.ebooks_kids USING GIN (theme_slugs);
CREATE INDEX IF NOT EXISTS ebooks_kids_buyer_jobs_gin  ON public.ebooks_kids USING GIN (buyer_job_tags);

INSERT INTO public.kids_age_groups (slug, label_en, label_th, min_age, max_age, sort_order)
VALUES
  ('3-5', '3-5 · Picture Books', '3-5 · หนังสือภาพ', 3, 5, 15),
  ('6-8', '6-8 · Early Readers', '6-8 · หัดอ่านเอง',  6, 8, 25)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.kids_themes (slug, label_en, label_th, sort_order)
VALUES
  ('kindness',       'Kindness & Sharing',      'ความเมตตาและการแบ่งปัน',   10),
  ('courage',        'Courage & Trying Again',  'ความกล้าและลองอีกครั้ง',    11),
  ('big-feelings',   'Big Feelings',            'อารมณ์ยิ่งใหญ่',            12),
  ('helping-others', 'Helping Others',          'การช่วยเหลือผู้อื่น',        13)
ON CONFLICT (slug) DO NOTHING;

UPDATE public.ebooks_kids ek
   SET age_band = ag.slug
  FROM public.kids_age_groups ag
 WHERE ek.age_group_id = ag.id
   AND (ek.age_band IS NULL OR ek.age_band = '');

UPDATE public.ebooks_kids ek
   SET theme_slugs = COALESCE(sub.slugs, ARRAY[]::text[])
  FROM (
    SELECT ek2.id,
           ARRAY(
             SELECT t.slug
               FROM public.kids_themes t
              WHERE t.id = ANY(ek2.theme_ids)
           ) AS slugs
      FROM public.ebooks_kids ek2
     WHERE ek2.theme_ids IS NOT NULL
       AND array_length(ek2.theme_ids, 1) > 0
  ) sub
 WHERE ek.id = sub.id
   AND (ek.theme_slugs IS NULL OR array_length(ek.theme_slugs,1) IS NULL);

INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, metadata)
VALUES (
  'kids_catalog_taxonomy',
  1,
  '# Kids Catalog Taxonomy v1

Age bands (Amazon-mapped): 0-3, 3-5, 4-6, 6-8.
Book types: illustrated_storybook, coloring_book.
Developmental themes: bedtime, kindness, courage, big-feelings, friendship-family, helping-others, stem-educational, humor-fun.
Buyer-job personas: parent_calm (calmer bedtimes), teacher (discussion-ready), gift (keepsake).

Every kids product carries an age_band, a book_type, one-or-more theme_slugs, and zero-or-more buyer_job_tags. These drive storefront filters, category landing pages, and product-card badges.',
  'seed',
  jsonb_build_object(
    'age_bands', jsonb_build_array('0-3','3-5','4-6','6-8'),
    'book_types', jsonb_build_array('illustrated_storybook','coloring_book'),
    'themes', jsonb_build_array('bedtime','kindness','courage','big-feelings','friendship-family','helping-others','stem-educational','humor-fun'),
    'buyer_jobs', jsonb_build_array('parent_calm','teacher','gift')
  )
)
ON CONFLICT (skill_key, version) DO UPDATE
  SET content_md = EXCLUDED.content_md,
      metadata   = EXCLUDED.metadata;
