# Phase 2 — Campaigns, Bundles, and Seasonal Calendar

Build the layer that turns Phase 1's authoritative pricing into automated, calendar-aware promotions and cross-sell bundles for the `/kids` storefront.

## Goals

1. Seasonal calendar drives US-retail promotions automatically (Back-to-School, Halloween, Thanksgiving, Black Friday/Cyber Monday, Christmas, Valentine's, Easter, Mother's/Father's Day, Summer Break).
2. Time-boxed campaigns (with compare-at prices) resolve through the same `product_pricing` engine — no bypass of the $5 floor or FTC compare-at legitimacy rule.
3. Bundle matching engine composes 2-3 book bundles by age band + theme with automatic bundle discount.
4. Storefront surfaces active campaign badge + bundle upsell on product page.
5. Everything is autopilot-managed; admin can override.

## Data model (new / extended)

- `campaigns` — id, slug, name, kind (`seasonal|flash|evergreen`), season_key, starts_at, ends_at, status (`draft|scheduled|live|ended`), discount_pct (int), min_price_floor_cents (default 500), audience filter (age_band[], book_type[]), auto_generated bool.
- `campaign_products` — join: campaign_id, product_kind, product_id, compare_at_cents (validated via existing `is_compare_at_price_legitimate`).
- `seasonal_calendar_seed` — static US retail calendar (used once to seed `campaigns` for the next 12 months).
- `bundles` — id, slug, title, age_band, theme, book_ids (uuid[]), bundle_price_cents, savings_cents, status, auto_generated.
- `bundle_events` — assemble/publish audit trail.

All tables: RLS on, `GRANT SELECT` to `anon` for public read of `live` rows only, admin write via `has_role('admin')`.

## Edge functions

- `marketing-calendar-sync` (cron daily) — ensures next 90 days of seasonal campaigns exist in `campaigns` from the seed.
- `marketing-campaign-runner` (cron every 15 min) — flips `scheduled → live → ended`; on live-transition, writes `product_pricing` rows (campaign price + compare-at) and `price_history`; on end, restores baseline.
- `marketing-bundle-composer` (cron hourly) — for each age band, picks top 3 live books by theme adjacency and (re)generates a bundle row; skips if same composition already active.
- `marketing-autopilot-tick` — orchestrator wrapper that fans out to the three above; single entry point for admin "Run Now".

All functions: JWT bypass off by default, service-role only, `pipeline_step_logs` emission, typed errors.

## Frontend

- `useActiveCampaign(productId)` — resolves the highest-priority live campaign for a product; returns `{ badge, comparativePriceCents, savingsPct, endsAt }`.
- `useSuggestedBundle(productId)` — returns the best current bundle containing this product.
- `ColoringProduct.tsx`: add campaign ribbon (uses existing overlay style, no baked-in text on cover), compare-at strikethrough, countdown to `endsAt`, "Complete the set — save $X" bundle upsell card.
- `/kids` grid card: small season badge chip when a book is in an active campaign.
- Admin `/admin/marketing`: read-only dashboards for active campaigns, upcoming calendar, and current bundles, plus a "Trigger now" button that invokes `marketing-autopilot-tick`.

## Guardrails (non-negotiable)

- Every price write goes through `pricing-resolver` — never a direct `product_pricing` update. The resolver already enforces the $5 floor.
- Compare-at prices are validated by `public.is_compare_at_price_legitimate` (30-day rule) before insert; failures downgrade the row to `discount_only` without compare-at.
- Campaign discount pct clamped to 5-40%.
- Bundle price = sum(members.effective_price) × (1 - bundle_discount), never below $5 × member_count × 0.6.
- Idempotent: re-running any cron produces zero writes if state matches.

## Verification

- Unit tests for calendar-sync (idempotency, 90-day window), campaign-runner (state machine transitions, compare-at rejection), bundle composer (no duplicate active bundles).
- Integration: dry-run mode that logs planned writes without persisting.
- Manual: trigger `marketing-autopilot-tick`, confirm one seasonal campaign flips live, storefront shows badge + countdown, admin sees bundle.

## Out of scope for Phase 2

- Email/push notification of campaigns (Phase 3).
- A/B testing of discount depth (Phase 4).
- Cross-market pricing beyond `us` (Phase 5).

## Rollout

Ship behind `platform_settings.marketing_autopilot_v2_enabled` (default false). Owner flips it on after reviewing the first 24 hours of admin dashboard output.

Approve to build.
