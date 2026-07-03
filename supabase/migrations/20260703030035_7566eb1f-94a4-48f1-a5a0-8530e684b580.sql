
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS reader_experience_qc jsonb,
  ADD COLUMN IF NOT EXISTS reader_experience_status text,
  ADD COLUMN IF NOT EXISTS reader_experience_score integer,
  ADD COLUMN IF NOT EXISTS reader_experience_fix_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reader_experience_attempted_at timestamptz;

COMMENT ON COLUMN public.ebooks.reader_experience_qc IS 'Reader Experience QC v1: 11-score rubric + structured issues + rewrite log';
COMMENT ON COLUMN public.ebooks.reader_experience_status IS 'idle | running | pass | needs_review';
