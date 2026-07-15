ALTER TABLE public.ebooks_kids
  ADD COLUMN IF NOT EXISTS pdf_byte_size BIGINT,
  ADD COLUMN IF NOT EXISTS pdf_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS pdf_metadata_derived_at TIMESTAMPTZ;
COMMENT ON COLUMN public.ebooks_kids.pdf_byte_size IS 'Phase 7: derived from actual final PDF bytes at finalize. Never planning-time.';
COMMENT ON COLUMN public.ebooks_kids.pdf_sha256 IS 'Phase 7: sha256 of the exact bytes uploaded to storage.';
COMMENT ON COLUMN public.ebooks_kids.pdf_metadata_derived_at IS 'Phase 7: timestamp when page_count/pdf_byte_size/pdf_sha256 were last derived from actual bytes.';