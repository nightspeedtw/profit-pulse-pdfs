
-- Fix upsert inference: PostgREST cannot pass the WHERE predicate for a
-- partial unique index, so ON CONFLICT (coloring_v2_book_id) errored with
-- 42P10. Replace with a non-partial unique index — NULLs are still allowed
-- to repeat (Postgres treats NULL as distinct in UNIQUE), so legacy V1 rows
-- with NULL coloring_v2_book_id are unaffected.
DROP INDEX IF EXISTS public.ebooks_kids_coloring_v2_book_id_unique;
CREATE UNIQUE INDEX ebooks_kids_coloring_v2_book_id_unique
  ON public.ebooks_kids (coloring_v2_book_id);
