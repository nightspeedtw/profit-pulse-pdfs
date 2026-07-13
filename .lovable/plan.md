## Problem

Kids Autopilot's "Recent runs" shows "No runs yet" even though runs exist in the database. Root cause: `autopilot_kids_runs` has an admin-only RLS policy; when your session isn't recognized as admin (signed out or switched accounts), the query silently returns `[]` and the UI shows the empty-state.

The page currently has no loading state, no error state, and no not-signed-in / not-admin state — so any auth issue looks identical to "no data".

## Fix (frontend only)

Edit `src/pages/admin/KidsAutopilot.tsx`:

1. Add three UI states around the runs list:
   - **loading** — while the first `load()` is in flight, show "Loading recent runs…".
   - **not signed in** — if `supabase.auth.getUser()` returns no user, show "Sign in as an admin to see recent runs" with a link to `/auth`.
   - **not admin** — if signed in but `has_role(uid, 'admin')` returns false (query `user_roles` client-side), show "This account isn't an admin — recent runs are admin-only."
   - **error** — if the runs query returns a Supabase error, show the error message inline (red) instead of "No runs yet".
   - **empty** — keep the existing "No runs yet." only when we truly got `[]` back with no error and user is admin.

2. Wrap `load()` in try/catch and store `loadError` in state; log full error to console for debugging.

3. Keep the existing child-run filter (`!row.metadata?.parent_run_id`) unchanged.

No backend, RLS, or edge-function changes. No thresholds, no Shopify, no fake reviews.

## Files changed

- `src/pages/admin/KidsAutopilot.tsx` — add auth check, admin check, loading/error states, try/catch around load.
