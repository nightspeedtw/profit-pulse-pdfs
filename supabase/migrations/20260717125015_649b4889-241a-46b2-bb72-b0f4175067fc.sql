
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, age_band, sort_index, metadata)
VALUES (
  'coloring-cover-thumbnail-contract-v1', 1,
  'Coloring cover + thumbnail publish contract v1: (1) cover_baked_title_only — typography_source must equal ideogram_verified_integrated, no overlays; (2) trim_verified — cover 1600x2071, interior 1600x2071, thumbnail 600x776, PDF 612x792pt; (3) thumbnail_distinct_and_fitted — thumbnail_url must differ from cover_url, 600x776 white-canvas fit-contain, non_crop_pass=true. Enforced by _shared/coloring/publish-contract.ts and kids-publish-if-qc-passed. Do not lower or waive.',
  'seed', 'cover_and_thumbnail', 'all', 0,
  jsonb_build_object(
    'contract_version', 'coloring_cover_thumbnail_contract_v1',
    'lane', 'coloring_book',
    'rules', jsonb_build_array(
      jsonb_build_object('id', 'cover_baked_title_only', 'required_source', 'ideogram_verified_integrated'),
      jsonb_build_object('id', 'trim_verified',
        'cover_px', jsonb_build_object('width', 1600, 'height', 2071),
        'thumbnail_px', jsonb_build_object('width', 600, 'height', 776),
        'pdf_pt', jsonb_build_object('width', 612, 'height', 792),
        'tolerance', 0.01),
      jsonb_build_object('id', 'thumbnail_distinct_and_fitted',
        'canvas', jsonb_build_object('width', 600, 'height', 776, 'format', 'image/jpeg'))
    )
  )
)
ON CONFLICT (skill_key, version) DO UPDATE SET
  content_md = EXCLUDED.content_md,
  metadata = EXCLUDED.metadata,
  updated_at = now();
