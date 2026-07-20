UPDATE public.coloring_v2_books
SET stage = 'cover', qc_status = 'pending', approved_cover_asset_id = NULL, updated_at = now()
WHERE id IN (
  'c6abc2e0-bc79-46e8-be30-f181b17875e9',
  'd1ac07f4-011d-4e60-8802-3696e8166d02',
  '60015e29-683b-4504-976b-18b1ccd44b07'
);

INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, metadata)
VALUES (
  'cover_bake_only_v6_hard_reject', 61,
  'V2 cover stage must never ship a best-attempt cover when OCR fails. Hard reject on ANY misspelling, extra hallucinated word, hard-banned chip/ribbon token, or duplicate age badge. On reject after 5 attempts, throw so retry supervisor requeues.',
  'seed', 'cover_typography',
  jsonb_build_object('applied_at', now(), 'law', 'cover_bake_only_v6_hard_reject')
);