-- Tighten public-write policy on coloring_book_events so it isn't literally `true`.
DROP POLICY IF EXISTS "anyone can insert funnel events" ON public.coloring_book_events;

CREATE POLICY "anyone can insert funnel events"
  ON public.coloring_book_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    ebook_kids_id IS NOT NULL
    AND length(coalesce(session_id, '')) <= 128
    AND octet_length(metadata::text) <= 2048
  );