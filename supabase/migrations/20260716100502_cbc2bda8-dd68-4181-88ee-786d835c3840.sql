-- Add age_min / age_max to ebooks_kids so /kids filter chips can use
-- range-overlap logic instead of brittle string matching. Values are
-- derived from the row's stored band (age_band text OR
-- metadata.coloring_age_band key) using both taxonomy tables.

ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS age_min integer,
  ADD COLUMN IF NOT EXISTS age_max integer;

-- Backfill from coloring_age_bands (metadata.coloring_age_band) first
UPDATE public.ebooks_kids ek
   SET age_min = b.age_min,
       age_max = b.age_max
  FROM public.coloring_age_bands b
 WHERE (ek.age_min IS NULL OR ek.age_max IS NULL)
   AND ek.metadata ? 'coloring_age_band'
   AND (ek.metadata->>'coloring_age_band') = b.key;

-- Backfill from the storybook age_band text using an inline mapping.
UPDATE public.ebooks_kids ek
   SET age_min = m.age_min,
       age_max = m.age_max
  FROM (
    VALUES
      ('0-3',  0,  3),
      ('2-4',  2,  4),
      ('3-5',  3,  5),
      ('4-6',  4,  6),
      ('5-7',  5,  7),
      ('6-8',  6,  8),
      ('7-9',  7,  9),
      ('8-12', 8, 12),
      ('9-12', 9, 12),
      ('13+', 13, 17),
      ('13-17', 13, 17),
      ('all_ages', 2, 99),
      ('all-ages', 2, 99)
  ) AS m(band, age_min, age_max)
 WHERE (ek.age_min IS NULL OR ek.age_max IS NULL)
   AND ek.age_band = m.band;

CREATE INDEX IF NOT EXISTS ebooks_kids_age_range_idx
  ON public.ebooks_kids (age_min, age_max)
  WHERE listing_status = 'live' AND sellable = true;