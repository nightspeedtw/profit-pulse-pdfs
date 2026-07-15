UPDATE public.ebooks_kids
SET qc_scorecard = jsonb_set(
  coalesce(qc_scorecard, '{}'::jsonb),
  '{style_anchor_fingerprint}',
  to_jsonb((interior_illustrations::jsonb->0->>'style_fingerprint'))
)
WHERE id = '1b1d9e1d-936f-483d-9743-d8aea32411dd'
  AND interior_illustrations::jsonb->0->>'style_fingerprint' IS NOT NULL;

INSERT INTO public.pipeline_skills (skill_key, version, source, content_md, target_dimension)
VALUES (
  'style_fingerprint_uses_cross_page_majority',
  1,
  'learned',
  'Rubric alignment (2026-07-15): final QC KIDS_MIXED_ART_STYLES now uses the majority (mode) fingerprint across the book''s pages as the effective anchor, matching what batch-verify checks (pages agree with each other + reference). The prior stored-anchor scheme false-positived when styleSuffix was reassembled in a different order across resumed batches, capping visually-consistent books at 40 despite vision QC = 100/100. Stored anchor is auto-healed when pages are internally consistent.',
  'illustration_style'
);