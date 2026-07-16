INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, metadata)
VALUES (
  'coloring_cover_textless_forever',
  1,
  'Coloring-lane covers are FOREVER textless-from-the-model. The app overlay (renderKidsTitleTreatment + age badge + logo) is the only typography source. The raw-art prompt MUST include TEXTLESS_DIRECTIVE and MUST NOT contain the book title string. buildColoringCoverArtPrompt() asserts both invariants at build time and throws structurally on any regression. The raw-art transcription gate rejects any detected glyphs pre-composite (defense in depth). No ideogram/titled rung is allowed on the coloring lane — the picture-book lane is untouched by this law.',
  'seed',
  jsonb_build_object(
    'lane', 'coloring_book',
    'never_expires', true,
    'regression_tests', ARRAY['src/lib/coloringCoverTextlessForever.test.ts'],
    'code_paths', ARRAY[
      'supabase/functions/_shared/coloring/cover-prompt.ts',
      'supabase/functions/coloring-book-cover/index.ts',
      'supabase/functions/_shared/covers/cover-vision-guards.ts'
    ]
  )
);