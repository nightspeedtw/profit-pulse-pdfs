UPDATE public.ebooks
SET
  pdf_status = 'idle',
  pdf_approved = false,
  cover_approved = false,
  reader_experience_status = NULL,
  reader_experience_score = NULL,
  canonical_status = 'needs_action',
  updated_at = now()
WHERE pdf_url IS NOT NULL
  AND (
    pdf_score < 90
    OR (pdf_qc->>'readability_score')::int < 90
    OR (pdf_qc->>'layout_score')::int < 90
    OR (pdf_qc->>'worksheet_readability_score')::int < 90
    OR (pdf_qc->>'cover_full_bleed_score') IS NULL
    OR (pdf_qc->>'cover_full_bleed_score')::int < 100
    OR thumbnail_url IS NULL
    OR reader_experience_score IS NULL
  );