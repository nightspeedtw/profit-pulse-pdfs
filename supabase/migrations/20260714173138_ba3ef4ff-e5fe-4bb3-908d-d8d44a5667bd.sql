
UPDATE public.ebooks_kids
SET pipeline_status = 'retired',
    listing_status = 'draft',
    sellable = false,
    blocker_reason = 'retired: budget_exhausted:character_identity — regenerating under new verify-as-you-go architecture'
WHERE id = '12708bfc-0cdf-4445-94f2-26924e41de9c';

INSERT INTO public.pipeline_skills (skill_key, source, version, target_dimension, content_md, metadata, created_at, updated_at)
VALUES (
  'gate_order_principle',
  'learned',
  1,
  'pipeline_architecture',
  E'# Gate Order Principle\n\n**Money is only spent after everything cheap has passed.**\n\n## Order\n1. Deterministic text gates (segment count, word counts, refrain presence, banned content) — FREE.\n2. Story judge (LLM) — cheap.\n3. Character sheet QC (1 image anchor) — cheap.\n4. **Per-batch visual verification DURING illustration (verify-as-you-go, regenerate failing pages immediately, cap 2 retries/page).**\n5. Final whole-book vision QC — confirmation only, never discovery.\n\n## Rationale\nSix consecutive books retired budget_exhausted:character_identity because off-model pages were only discovered AFTER all 28 pages were spent. And Peculiar Plinks died from a manuscript segment-count mismatch discovered post-illustration. Fix: verify at birth per 8-page batch; validate structured N segments deterministically before any image spend.\n\n## Enforcement\n- Character pages MUST use reference-conditioned gemini image (Fal Schnell is text-only → guaranteed drift).\n- Fal allowed only for non-character assets.\n- Per-batch vision threshold: character_match ≥ 78, cover_interior_match ≥ 75.\n- pdf_building status is a FREE resume state — never retire on unrecognized_stall until 5 resume attempts.',
  jsonb_build_object(
    'enforcement', jsonb_build_object(
      'character_pages_reference_conditioned', true,
      'per_batch_verify_thresholds', jsonb_build_object('character_match_min', 78, 'cover_interior_match_min', 75),
      'per_page_regen_cap', 2,
      'pdf_building_free_resume_attempts', 5
    ),
    'retired_cohort', jsonb_build_array('Wobbly Widget Wagon','Chef Pip','Detective Dot','Peculiar Plinks','Pip Perfect Pudding')
  ),
  now(), now()
)
ON CONFLICT DO NOTHING;
