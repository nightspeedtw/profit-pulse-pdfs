ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS auto_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_approved_by uuid;