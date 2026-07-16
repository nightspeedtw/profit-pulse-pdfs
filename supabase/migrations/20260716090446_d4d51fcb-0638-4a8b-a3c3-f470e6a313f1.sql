
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, metadata)
VALUES (
  'coloring_anatomy_verifier_model_ladder_v1',
  1,
  'A vision-verifier HTTP error (404 model deprecated, 5xx, timeout, JSON parse fail) is a PROVIDER-STATE outage, NOT a quality verdict. It MUST NOT fail the page, MUST NOT score the page 0, MUST NOT increment coloring_repair_attempts, MUST NOT delete storage. The verifier walks generation_settings.coloring_autopilot.anatomy_verifier_models (default: google/gemini-3.5-flash then google/gemini-3-flash-preview then google/gemini-3.1-flash-lite) through the Lovable AI Gateway; a degraded verdict is only returned when EVERY model in the ladder fails. Consecutive verifier failures increment coloring_autopilot.anatomy_verifier_blocked.consecutive_failures; at 3 the lane flips active=true and coloring-book-render/assemble halt with reason=anatomy_verifier_blocked (same pattern as provider_billing_locked). First healthy call clears the flag + counter. Same fix pattern applies to ALL vision verifiers (cover vision, transcription QC, thumbnail QC).',
  'seed',
  jsonb_build_object(
    'regression_tests', ARRAY['src/lib/coloringAnatomyVerifierGuard.test.ts'],
    'code_paths', ARRAY[
      'supabase/functions/_shared/coloring/anatomy-verify.ts',
      'supabase/functions/_shared/coloring/anatomy-verifier-guard.ts',
      'supabase/functions/coloring-book-render/index.ts',
      'supabase/functions/coloring-book-assemble/index.ts'
    ],
    'supersedes', ARRAY['coloring_anatomy_gate_v1'],
    'never_expires', true
  )
)
ON CONFLICT DO NOTHING;

UPDATE public.generation_settings
SET coloring_autopilot = COALESCE(coloring_autopilot, '{}'::jsonb)
  || jsonb_build_object(
    'anatomy_verifier_models', jsonb_build_array(
      'google/gemini-3.5-flash',
      'google/gemini-3-flash-preview',
      'google/gemini-3.1-flash-lite'
    ),
    'anatomy_verifier_blocked', jsonb_build_object(
      'active', false,
      'consecutive_failures', 0,
      'cleared_at', to_jsonb(now())
    )
  )
WHERE id = 1;

WITH candidates AS (
  SELECT ek.id AS ebook_id, ek.metadata
  FROM public.ebooks_kids ek
  WHERE ek.book_type = 'coloring_book'
    AND ek.metadata ? 'coloring_repair_attempts'
),
per_page AS (
  SELECT c.ebook_id, c.metadata,
         (jsonb_each_text(c.metadata->'coloring_repair_attempts')).key AS page_key,
         (jsonb_each_text(c.metadata->'coloring_repair_attempts')).value::int AS attempt_count
  FROM candidates c
),
page_verdict AS (
  SELECT p.ebook_id, p.metadata, p.page_key, p.attempt_count,
    COALESCE((
      SELECT bool_and(
        (e->>'error') ~* '(anatomy_verifier_degraded|anatomy_unmeasured|anatomy_no_verdict|provider_billing_locked|exhausted balance|user is locked|^403:|^404:|no longer available)'
      )
      FROM jsonb_array_elements(COALESCE(p.metadata->'coloring_last_errors','[]'::jsonb)) e
      WHERE (e->>'page') IS NOT NULL AND (e->>'page') = p.page_key
    ), false) AS all_provider
  FROM per_page p
),
new_attempts AS (
  SELECT ebook_id,
         COALESCE(jsonb_object_agg(page_key, attempt_count) FILTER (WHERE NOT all_provider), '{}'::jsonb) AS attempts,
         array_agg(page_key) FILTER (WHERE all_provider) AS cleared_pages
  FROM page_verdict
  GROUP BY ebook_id
)
UPDATE public.ebooks_kids ek
SET metadata = ek.metadata
  || jsonb_build_object(
    'coloring_repair_attempts', na.attempts,
    'coloring_verifier_cleanup_at', to_jsonb(now()),
    'coloring_verifier_cleanup_pages', to_jsonb(COALESCE(na.cleared_pages, ARRAY[]::text[]))
  )
FROM new_attempts na
WHERE ek.id = na.ebook_id
  AND na.cleared_pages IS NOT NULL
  AND array_length(na.cleared_pages, 1) > 0;
