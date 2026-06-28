ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS pdf_html_url TEXT,
  ADD COLUMN IF NOT EXISTS pdf_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pdf_qc JSONB,
  ADD COLUMN IF NOT EXISTS pdf_score INTEGER,
  ADD COLUMN IF NOT EXISTS pdf_layout_score INTEGER,
  ADD COLUMN IF NOT EXISTS pdf_readability_score INTEGER,
  ADD COLUMN IF NOT EXISTS pdf_worksheet_score INTEGER,
  ADD COLUMN IF NOT EXISTS pdf_diagram_score INTEGER,
  ADD COLUMN IF NOT EXISTS pdf_render_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pdf_page_count INTEGER,
  ADD COLUMN IF NOT EXISTS bonus_section_json JSONB,
  ADD COLUMN IF NOT EXISTS action_plan_json JSONB;

ALTER TABLE public.ebooks DROP CONSTRAINT IF EXISTS ebooks_pdf_status_check;
ALTER TABLE public.ebooks ADD CONSTRAINT ebooks_pdf_status_check
  CHECK (pdf_status IN ('idle','rendering','rendered','needs_review','failed','approved'));
