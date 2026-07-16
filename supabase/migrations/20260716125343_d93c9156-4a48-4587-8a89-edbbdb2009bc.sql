
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, sort_index, metadata)
VALUES (
  'cover_can_never_fail',
  1,
  E'# Owner law: cover_can_never_fail (skill: coloring_cover_forever)\n\n' ||
  E'Every book that reaches the cover stage already owns 32 interior pages that passed the anatomy, colorability, and textless gates. A cover built FROM THEM cannot be blank, off-category, or text-contaminated.\n\n' ||
  E'## Two-rung contract\n' ||
  E'- Rung 1 (nice-to-have): up to 3 Flux/Schnell textless full-color scene attempts. Each measured for luminance/colorfulness, text-in-art, and category subject fit.\n' ||
  E'- Rung 2 (guaranteed): deterministic self-art cover — scanline flood-fill colorization of the 1-3 top interior pages using a per-category warm kid palette, composed on a palette-tinted canvas. Pure CPU, no AI, always succeeds. Replaces the blank/gradient synthetic fallback PERMANENTLY.\n\n' ||
  E'## Deleted forever\n' ||
  E'- Any blank/gradient synthetic cover background (renderSyntheticCoverBackground).\n' ||
  E'- The single-rung mark-blocked-and-hope loop for coloring covers.\n\n' ||
  E'## Release-blocking test\n' ||
  E'src/lib/coloringCoverForeverSkill.test.ts',
  'seed',
  'cover_reliability',
  1,
  jsonb_build_object(
    'owner_law', true,
    'law_name', 'cover_can_never_fail',
    'supersedes', jsonb_build_array('coloring_cover_single_rung_v1'),
    'implemented_in', jsonb_build_array(
      'supabase/functions/coloring-book-cover/index.ts',
      'supabase/functions/_shared/coloring/self-art-cover.ts',
      'supabase/functions/_shared/coloring/coloring-palettes.ts'
    ),
    'regression_test', 'src/lib/coloringCoverForeverSkill.test.ts',
    'declared_at', now()
  )
)
ON CONFLICT (skill_key, version) DO UPDATE
  SET content_md = EXCLUDED.content_md,
      metadata   = EXCLUDED.metadata,
      updated_at = now();
