ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS rehydrated_from uuid REFERENCES public.ebooks_kids(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ebooks_kids_rehydrated_from_idx
  ON public.ebooks_kids(rehydrated_from);

COMMENT ON COLUMN public.ebooks_kids.rehydrated_from IS
  'When a book cannot be repaired in place (identity_guard/ever_live tombstone), a fresh row is inserted with the same concept and this column points back to the original. The original stays as permanent evidence.';