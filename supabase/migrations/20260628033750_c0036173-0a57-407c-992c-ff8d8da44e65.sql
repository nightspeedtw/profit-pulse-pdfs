
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS final_manuscript_qc jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_manuscript_score integer,
  ADD COLUMN IF NOT EXISTS reader_value_score integer,
  ADD COLUMN IF NOT EXISTS practical_tool_score integer,
  ADD COLUMN IF NOT EXISTS editorial_polish_score integer,
  ADD COLUMN IF NOT EXISTS refund_risk_score integer,
  ADD COLUMN IF NOT EXISTS manuscript_fix_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manuscript_qc_status text;
