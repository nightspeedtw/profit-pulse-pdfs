# Plan — Stop credit burn, enforce lanes, add 3-strike alerting

## 1. Enforce provider lanes (permanent law)
- **Covers (v2 + kids)** → Gemini direct only, OpenAI as emergency fallback. No Runware/CF/Ideogram in cover paths. Already partially done in `coloring-v2-cover`; audit and remove any remaining non-smart-AI calls from `kids-cover*`, `ideogram-integrated-cover.ts`, `covers/*` still active in the pipeline.
- **Interior pages** → Cloudflare Flux-1-Schnell primary (cheap), Runware fallback. Never route interior through Gemini/OpenAI image APIs.
- Add a compile-time guard in `_shared/lane-guard.ts` that throws if `step` contains `cover_*` and provider is CF/Runware, or if `step` contains `interior_*` and provider is `google_direct`/`openai_direct`. Called from every image adapter.

## 2. 3-strike circuit breaker → Admin Dashboard alert
- New table `provider_incidents` (provider, error_class, strike_count, first_seen, last_seen, resolved_at, book_id).
- New helper `_shared/circuit-breaker.ts`:
  - Increments strike on billing/quota/auth errors from cost_log classifier.
  - At **strike 3 within 15 min** for the same provider: flip `platform_settings.autopilot_frozen=true`, write `admin_alerts` row (`severity=critical`, `channel=dashboard`), and abort the current book's stage cleanly (park to `awaiting_admin`, not `failed`).
  - No more retries against that provider until an admin clicks "Resolve" on Dashboard.
- Dashboard: add `<HealthIncidentBanner>` at top of `admin/Dashboard.tsx` reading unresolved `admin_alerts` — red banner with provider name, error class, "Resolve & Resume" button.

## 3. Credit-burn audit (find where money went)
- Add read-only admin page `/admin/spend-audit` that groups `cost_log` last 24h by:
  - provider × step × success — expose failed calls that still cost money (e.g. Gemini 429s that were retried, OpenAI hard-limit hits).
  - book_id × total_cost — flag books >$2 with no published output.
- Backfill query in the plan output shows the top 20 burn rows so we can diagnose the current situation immediately after implementation.
- Likely culprits to confirm from the audit before further code changes:
  1. Retry loops on billing errors (should be caught by circuit breaker above).
  2. Cover ladder rungs each billing 1 Gemini call even after first failure.
  3. Interior pacer overshoot on Runware fallback when CF quota latches.

## 4. Continue book queue after fix
Once lanes + breaker are live and admin unlocks, resume with `Gears and Galleons` (83 pages, stage=cover), then `Cobblestone Creatures`, then `Tokyo Twilight Towers` — one at a time per `one-book-at-a-time-law`.

## Technical notes
- Files to edit: `supabase/functions/_shared/{lane-guard.ts (new), circuit-breaker.ts (new), gemini-direct.ts, openai-direct.ts, image-providers.ts, coloring-v2/image-fallback.ts}`, `supabase/functions/coloring-v2-cover/index.ts`, `supabase/functions/coloring-v2-autopilot/index.ts`, `src/pages/admin/Dashboard.tsx`, `src/pages/admin/SpendAudit.tsx (new)`, `src/components/admin/HealthIncidentBanner.tsx` (extend).
- Migration: `provider_incidents`, `admin_alerts` (if not present), plus GRANTs + RLS admin-only.
- Law file: `.lovable/three-strike-circuit-breaker-law.md`.

No book generation triggered until the breaker is live — prevents another burn cycle.
