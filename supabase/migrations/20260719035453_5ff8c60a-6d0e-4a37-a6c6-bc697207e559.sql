INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, sort_index, metadata) VALUES
('coloring_rulebook_v1_no_solid_black_gate', 1,
 '# Coloring Rulebook v1 — Solid-Black Gate REMOVED (2026-07-19)

Owner amendment. Solid-black is no longer a gate on the coloring lane.
Removed from render gate chain, assembly sweep, and repair-ladder classes
(deleted `solid_black_fill`; removed `large_solid_black_area` from
`COLORING_HARD_FAIL_ZERO_KEYS`). Only a garbage-page sanity floor remains
(`garbage_image_broken` = majority-black unreadable image). The de-fill
post-processor becomes an OPTIONAL silent enhancement pass. Unblocks
the largest historical failure class (~255 rejections) so dark-subject
books (orca, penguin, wolf, cow) flow freely.',
 'seed', 'coloring_lane', 10,
 jsonb_build_object('amendment_of','coloring_rulebook_v1','removed_gate','solid_black','date','2026-07-19')),
('coloring_rulebook_v1_scope_guard', 1,
 '# Coloring Rulebook v1 — Scope Guard (2026-07-19)

Owner amendment. Every rule under coloring_rulebook_v1 applies ONLY to
`book_type=coloring_book` (rulebook, anatomy deformity-only, cover
interiors-as-ref, title-spelling law, de-fill, waiver/learning mode,
coloring pricing, age-band chips, solid-black removal). Enforced by
`_shared/coloring/lane-invariants.ts::assertColoringOnly` +
`isColoringLane`. Regression test:
`src/__tests__/coloring-rulebook-scope-guard.test.ts` proves a
picture_book row through shared code hits zero coloring rulebook logic.',
 'seed', 'lane_isolation', 11,
 jsonb_build_object('amendment_of','coloring_rulebook_v1','scope','coloring_book_only','date','2026-07-19'))
ON CONFLICT (skill_key, version) DO UPDATE
  SET content_md = EXCLUDED.content_md,
      metadata = EXCLUDED.metadata,
      updated_at = now();