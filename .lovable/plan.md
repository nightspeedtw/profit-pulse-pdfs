# Fix "Could not load products: Load failed"

## Root cause

The public storefront calls the `list-storefront` edge function. That function's source still lives in the repo but was dropped from the deployed Supabase project (curl returns `NOT_FOUND_FUNCTION_BLOB`). Every page using `fetchStorefront` (`ProductGrid`, Product detail, Categories, marketing rails) fails as a result.

## Fix

1. Re-deploy `list-storefront` by making a trivial edit to `supabase/functions/list-storefront/index.ts` (add a version comment). Lovable's auto-deploy will push the current code.
2. While re-touching, verify the function no longer selects any removed Shopify columns (previous cleanup renamed `shopify_title/subtitle/meta` → `storefront_*`). Current file selects safe columns; no schema change needed.
3. Smoke-test with `curl` against the deployed URL to confirm items are returned.
4. If curl still 404s after redeploy, fall back to invoking `supabase.functions.invoke("list-storefront")` from a quick check, since that route uses the platform's discovery layer.

No frontend, DB, or schema changes are required — this is a deploy-only fix.

## Verification

- `curl .../functions/v1/list-storefront?limit=3` returns `{items: [...]}` with 200
- Home page and `/library` render product cards instead of the red error box