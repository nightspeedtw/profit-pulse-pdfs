
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS outline_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS total_word_count integer,
  ADD COLUMN IF NOT EXISTS writing_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS qc_status text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS outline_rewrite_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outline_qc jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ebook_chapters
  ADD COLUMN IF NOT EXISTS qc_status text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_ebooks_writing_status ON public.ebooks(writing_status);
