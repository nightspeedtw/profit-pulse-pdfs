-- Coloring book funnel events (feeds pricing Rule 2 popularity signal).
-- Anonymous inserts allowed; reads restricted to service_role/admin.

CREATE TABLE public.coloring_book_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_kids_id uuid NOT NULL REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('view_product','open_preview','preview_page_turn','click_buy')),
  session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coloring_book_events_book_created_idx
  ON public.coloring_book_events (ebook_kids_id, created_at DESC);
CREATE INDEX coloring_book_events_type_created_idx
  ON public.coloring_book_events (event_type, created_at DESC);
-- Session-level dedupe (best-effort; NULL sessions still allowed).
CREATE UNIQUE INDEX coloring_book_events_dedupe_idx
  ON public.coloring_book_events (ebook_kids_id, event_type, session_id, ((metadata->>'page_index')))
  WHERE session_id IS NOT NULL;

GRANT INSERT ON public.coloring_book_events TO anon, authenticated;
GRANT ALL ON public.coloring_book_events TO service_role;

ALTER TABLE public.coloring_book_events ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) may insert their own funnel event.
CREATE POLICY "anyone can insert funnel events"
  ON public.coloring_book_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read raw events (privacy).
CREATE POLICY "admins can read funnel events"
  ON public.coloring_book_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));