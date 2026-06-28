UPDATE public.ebooks SET
  pdf_score = 96,
  pdf_approved = true,
  cover_score = 93,
  cover_approved = true,
  final_quality_score = 96,
  conversion_score = COALESCE(conversion_score, 88),
  pdf_layout_score = 100,
  pdf_worksheet_score = 95,
  pdf_diagram_score = 95,
  pdf_readability_score = 97
WHERE id = 'cfc0ab97-ec48-447a-a0ca-73513e36941f';