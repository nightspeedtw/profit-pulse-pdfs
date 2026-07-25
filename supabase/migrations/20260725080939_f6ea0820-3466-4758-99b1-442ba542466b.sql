UPDATE coloring_v2_books
SET last_error = NULL, stage_attempt_count = 0, updated_at = now()
WHERE last_error IS NOT NULL
  AND stage IN ('page_plan','style_bible','interior_render')
  AND (
    last_error ILIKE '%insufficient_quota%'
    OR last_error ILIKE '%RESOURCE_EXHAUSTED%'
    OR last_error ILIKE '%duplicate key value%coloring_v2_page_plans_book_id_fingerprint_key%'
    OR last_error ILIKE '%PGRST116%'
    OR last_error ILIKE '%provider_billing_locked%cloudflare%'
  );