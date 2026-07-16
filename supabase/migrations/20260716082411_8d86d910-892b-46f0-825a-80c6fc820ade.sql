
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, metadata)
VALUES (
  'coloring_fal_provider_billing_lock_v1',
  1,
  'FAL 402/403 exhausted-balance/user-locked responses are lane-state, not page-content failures. They MUST NOT increment coloring_repair_attempts, MUST NOT trigger repair/replan/simplify/escalate, MUST flip generation_settings.coloring_autopilot.billing_blocked=true, and MUST halt further FAL dispatch until cleared. Auto-resume: a successful FAL call clears billing_blocked. Budget guard: coloring-worker-tick sums today fal_direct cost_log spend; when >= coloring_autopilot.fal_daily_budget_usd (default $5) the lane parks with fal_budget_cap_reached BEFORE balance dies mid-book.',
  'seed',
  jsonb_build_object(
    'regression_tests', ARRAY['src/lib/falBillingTaxonomy.test.ts'],
    'code_paths', ARRAY['supabase/functions/_shared/fal-billing.ts','supabase/functions/_shared/fal.ts','supabase/functions/coloring-book-render/index.ts','supabase/functions/coloring-worker-tick/index.ts'],
    'never_expires', true
  )
)
ON CONFLICT DO NOTHING;

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
        (e->>'error') ~* '(provider_billing_locked|exhausted balance|fal_budget_cap_reached|user is locked|payment required|^402:)'
      )
      FROM jsonb_array_elements(COALESCE(p.metadata->'coloring_last_errors','[]'::jsonb)) e
      WHERE (e->>'page') IS NOT NULL AND (e->>'page') = p.page_key
    ), false) AS all_billing
  FROM per_page p
),
new_attempts AS (
  SELECT ebook_id,
         COALESCE(jsonb_object_agg(page_key, attempt_count) FILTER (WHERE NOT all_billing), '{}'::jsonb) AS attempts,
         array_agg(page_key) FILTER (WHERE all_billing) AS cleared_pages
  FROM page_verdict
  GROUP BY ebook_id
)
UPDATE public.ebooks_kids ek
SET metadata = ek.metadata
  || jsonb_build_object(
    'coloring_repair_attempts', na.attempts,
    'coloring_replans',
      COALESCE((
        SELECT jsonb_object_agg(k, v)
        FROM jsonb_each(COALESCE(ek.metadata->'coloring_replans','{}'::jsonb)) AS r(k, v)
        WHERE NOT (na.cleared_pages IS NOT NULL AND k = ANY(na.cleared_pages))
      ), '{}'::jsonb),
    'coloring_billing_cleanup_at', to_jsonb(now()),
    'coloring_billing_cleanup_pages', to_jsonb(COALESCE(na.cleared_pages, ARRAY[]::text[]))
  )
FROM new_attempts na
WHERE ek.id = na.ebook_id
  AND na.cleared_pages IS NOT NULL
  AND array_length(na.cleared_pages, 1) > 0;

UPDATE public.generation_settings
SET coloring_autopilot = COALESCE(coloring_autopilot, '{}'::jsonb)
  || jsonb_build_object(
    'billing_blocked', jsonb_build_object(
      'active', true,
      'status', 403,
      'provider_message', 'Owner-verified: fal.ai balance exhausted. Top up at fal.ai/dashboard/billing then POST coloring-autopilot-config { billing_blocked:{active:false} } to resume.',
      'at', to_jsonb(now())
    ),
    'fal_daily_budget_usd', COALESCE(coloring_autopilot->'fal_daily_budget_usd', to_jsonb(5))
  )
WHERE id = 1;
