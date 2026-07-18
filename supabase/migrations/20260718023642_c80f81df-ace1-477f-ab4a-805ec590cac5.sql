
INSERT INTO pipeline_skills (skill_key, version, content_md, source, sort_index, metadata, updated_at)
VALUES (
  'provider_resilience_character_reference', 1,
  E'Character-reference sheet in autopilot-kids-pipeline MUST call generateImageWithFailover(opts, readImageProviderPolicy(db).interiors, db). Never call falFluxSchnell/falRecraftV3/runwareInference directly. Chain 2026-07-18: Runware runware:100@1 (FLUX schnell) primary, Cloudflare @cf/black-forest-labs/flux-1-schnell fallback, fal-ai/flux/schnell last. Character consistency preserved because downstream page render uses Gemini 3.1 flash-image reference-conditioning on the sheet URL — t2i provider identity does not affect character lock. Sibling of provider_resilience_single_funded_path (coloring covers). Fixed 62-book dead-end (25% of all failures) caused by fal.ai balance drought.',
  'seed', 1,
  jsonb_build_object('introduced_at','2026-07-18','sibling_of','provider_resilience_single_funded_path','affected_books_at_introduction',62),
  NOW()
)
ON CONFLICT (skill_key, version) DO UPDATE SET content_md = EXCLUDED.content_md, metadata = EXCLUDED.metadata, updated_at = NOW();
