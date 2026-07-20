
ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS coloring_v2_book_id uuid;

-- Backfill: for each V2 book referenced in metadata, pick the most-recent
-- ebooks_kids row as the canonical bridge and stamp the column. Other
-- duplicate rows keep coloring_v2_book_id NULL and are ignored by the
-- upsert path — they can be retired/hidden independently.
WITH ranked AS (
  SELECT id,
         (metadata->>'coloring_v2_book_id')::uuid AS v2_id,
         row_number() OVER (
           PARTITION BY metadata->>'coloring_v2_book_id'
           ORDER BY (listing_status = 'live') DESC, created_at DESC
         ) AS rn
    FROM public.ebooks_kids
   WHERE metadata ? 'coloring_v2_book_id'
     AND metadata->>'coloring_v2_book_id' IS NOT NULL
)
UPDATE public.ebooks_kids ek
   SET coloring_v2_book_id = r.v2_id
  FROM ranked r
 WHERE ek.id = r.id AND r.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS ebooks_kids_coloring_v2_book_id_unique
  ON public.ebooks_kids (coloring_v2_book_id)
  WHERE coloring_v2_book_id IS NOT NULL;
