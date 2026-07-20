
# SecretPDF Kids — AI Marketing Autopilot

A production-grade, always-on marketing brain that sits **beside** (never inside) the book-production pipeline. It owns pricing, promotions, bundles, merchandising, seasonal calendar, trend discovery, experiments, and attribution. Book generation, QC, PDF, cover, safety gates are untouched.

Scope is large. To keep it safe and reviewable, ship it in **6 sequenced phases** behind a master feature flag `MARKETING_AUTOPILOT` (default OFF) and a `mode` enum (`OFF | OBSERVE_ONLY | RECOMMEND_ONLY | AUTO_LOW_RISK | FULL_AUTOPILOT`). Each phase is independently mergeable and reversible.

---

## Phase 0 — Audit & guardrails (no behavior change)

Deliverable: written audit + PR that only removes misleading UI and adds feature flags.

Audit findings I'll capture before writing code:
- `src/lib/storefrontPricing.ts` — synthesizes fake compare-at price (55–70% off band) and fake platform reviews. **Remove.**
- `src/lib/saleConfig.ts` — reads `platform_settings.storefront_sale_config` as a sitewide toggle. Keep as a legacy shim for one release, then migrate readers to the new campaign resolver.
- `src/lib/coloringFunnelEvents.ts` — 4 event types, anon insert to `coloring_book_events`. Keep as-is; new ledger will subsume it via a compatibility writer.
- `supabase/functions/coloring-repricer/index.ts` + `_shared/coloring/pricing.ts` — daily popularity-only repricer with no cooldown / no experiment / no floor beyond ceiling. **Freeze** (no schedule change) then supersede in Phase 3.
- `supabase/functions/compute-pricing/index.ts` + `_shared/pricing.ts` — adult-ebook pricer, writes `ebooks.price*`. Out of scope for kids; leave untouched.
- `src/components/kids/KidsBookCard.tsx`, `MarketingRail.tsx`, `CompleteTheSetBundle.tsx` — read pricing + reviews from the helpers above. Update to use new resolvers.
- `src/pages/admin/AutopilotControl.tsx`, `Dashboard.tsx`, `PricingPanel.tsx` — admin surfaces; new `/admin/marketing-autopilot` route lives beside them.
- Payments: `_shared/stripe.ts` exists (gateway-only); `PAYMENTS_SANDBOX_WEBHOOK_SECRET` present. **No verified paid-order webhook path today** — Revenue/ROAS must render "Not Available" until webhook is wired in Phase 5.

Phase 0 code changes:
1. Add `src/config/features.ts` flags: `MARKETING_AUTOPILOT`, `MARKETING_HONEST_PRICING`, `MARKETING_REVIEWS_HONEST`. Mirror in `_shared/features.ts`.
2. `storefrontPricing.ts`: delete synthesis. `deriveSalePricing` returns `hasDiscount=false` unless a legitimate `compare_at_price_cents` **plus** a valid `price_history` regular-price record exists (validator stub returns false in Phase 0 — no crossed-out prices ship until Phase 3 makes it real).
3. `derivePlatformReview` → renamed to `deriveEditorialQuality`, returns `{ passedQC, verifiedPdf, ageChecked }`. Replace star UI on `KidsBookCard`, `ColoringProduct`, `MarketingRail` with a compact **"SecretPDF Editorial Quality"** badge (checkmarks, not stars, no count).
4. Add regression tests: no synthesized compare-at, no fake review count.

---

## Phase 1 — Data model (migrations only)

One migration per table group, all with GRANTs + RLS (admin read/write via `has_role('admin')`, service_role full, anon denied except `marketing_events` insert via edge function).

Tables:
- `marketing_settings` (singleton row): mode, market=`US`, timezone=`America/New_York`, all subsystem toggles, min_regular_price_cents=500, single_sale_floor=199, bundle_per_book_floor=199, max_discount_pct, cooldowns (regular_price=30d, campaign, $1.99=90d), min sample thresholds, ROAS targets, ad budget caps, emergency_stop {enabled, reason, actor, at}, rule_version.
- `product_pricing` (per ebook_kids_id): regular_price_cents, campaign_price_cents, effective_price_cents, value_tier, value_score, active_campaign_id, valid_from/to, locked_until, rule_version, confidence, updated_by.
- `price_history` (append-only): product_id, prev_price, new_price, price_type (`regular|campaign|introductory`), reason, campaign_id, experiment_id, ai_decision_id, metric_snapshot jsonb, effective_from/to, rollback_of.
- `marketing_calendar_events`: event_key, name, event_type (`official_holiday|retail|cultural|educational|social|observance`), country=`US`, date_rule (RRULE-ish jsonb), allowed_themes[], prohibited_themes[], priority, prep_windows jsonb (180/90/60/45/21/7).
- `campaigns`: type, slug UNIQUE, market, objective, status (`draft|scheduled|active|paused|expired|rolled_back`), starts_at, ends_at, budget_cents, target_metrics jsonb, expected_lift jsonb, actual_lift jsonb, confidence, source_signals jsonb, generated_copy jsonb, rollback_state jsonb.
- `campaign_products`: campaign_id, product_id, role (`hero|supporting|entry|premium_anchor|bundle|cross_sell|upsell`), score, reasons jsonb, regular_snapshot, campaign_snapshot, placement.
- `bundles`: title, slug UNIQUE, size, regular_price_cents, campaign_price_cents, active_from/to, generated_reason, quality_status, performance_status.
- `bundle_items`: bundle_id, product_id, sequence, price_snapshot, relevance_score, UNIQUE(bundle_id, product_id).
- `trend_signals`: source, provider, query, normalized_theme, country, subregion, signal_strength, growth_rate, baseline, confidence, first_detected, last_detected, expires_at, evidence jsonb, product_tags[], ingest_run_id.
- `marketing_events` (ecommerce ledger): event_id UUID PK, ts, session_id, user_id nullable, event_type (enum, 16 types), product_id, bundle_id, item_list_id/name, promotion_id/name, campaign_id, experiment_id/variant, regular_snapshot, campaign_snapshot, currency, quantity, country_code, region, device_class, source, medium, campaign_utm, referrer, landing_page, gclid, metadata jsonb, consent_state. Partitioned monthly.
- `attribution_touchpoints`: session_id, user_id, source/medium/campaign, click_ids jsonb, campaign_exposures jsonb, first_touch_at, last_non_direct_at, order_id.
- `marketing_experiments`: type, hypothesis, primary_metric, starts_at/ends_at, assignment_method (`switchback|holdout|geo`), switchback_schedule jsonb, min_sample, status, winner_variant, confidence, incremental_results jsonb.
- `ai_marketing_decisions`: run_id, decision_type, input_snapshot jsonb, evidence jsonb, reasoning_summary, proposed_action jsonb, executed_action jsonb, confidence, guardrail_results jsonb, rollback_action jsonb, outcome jsonb, learning_summary.
- `paid_orders` (source of truth for revenue): provider_txn_id UNIQUE, provider, status, amount_cents, currency, country, line_items jsonb (snapshotted), campaign_id, promotion_id, experiment_id/variant, session_id, user_id, webhook_received_at, refunded_amount_cents.
- Daily rollups: `mv_marketing_daily_product`, `_campaign`, `_bundle`, `_country`, `_source`, `_experiment` — refreshed by cron.

Seed: 2026 US calendar (movable feasts computed at seed time) with Back-to-School 2026 as top-priority active opportunity, Labor Day, Halloween, Thanksgiving→Cyber Monday.

---

## Phase 2 — Pricing engine + resolver

- `supabase/functions/_shared/marketing/price-resolver.ts` — **single authoritative resolver**. Signature `resolveEffectivePrice(productId, { at, country }): { regular, campaign?, effective, campaign_id?, source }`. Used by storefront SSR/CSR, cart, checkout intent, webhook validator.
- `_shared/marketing/price-ladder.ts` — snap-to-ladder helper using the approved 15-rung ladder ($5 → $149.99+, unbounded above).
- `_shared/marketing/value-score.ts` — computes `product_value_score` (0-100) from the 8 weighted dimensions; maps score → tier → snapped regular price. Persists to `ai_marketing_decisions` with inputs, weights, rule_version.
- `_shared/marketing/pricing-guardrails.ts` — enforces: min $5.00 regular, $1.99 single floor, bundle per-book floor $1.99, no stacking (single best offer), 30-day regular-price cooldown, 5% max regular movement/cycle, $1.99-per-SKU cooldown 90 days, ≥60% full-price days in rolling 90d (with BF/CM exception logging).
- `_shared/marketing/compare-at-validator.ts` — `isCompareAtPriceLegitimate(productId, compareAtCents, campaignStartAt)` returns true only when `price_history` shows the regular price publicly active ≥30 consecutive days, no permanent-discount pattern, valid campaign timestamps, compareAt > effective.
- Update storefront components to call the resolver; strike-through price renders only when validator returns true.
- New introductory-price affordance: products with age < 30 days show **"Introductory Price — ends [date]"** copy instead of a fake crossed-out price.

Tests (vitest, all fail-then-pass): floor enforcement, ladder snap, cooldowns, no-stacking, no-synth compare-at, introductory pricing, same-SKU-same-price invariant.

---

## Phase 3 — Autopilot jobs (Edge Functions + cron)

Every function idempotent (idempotency key on run_id + input hash), retry-safe, bounded, writes `ai_marketing_decisions`.

- `marketing-autopilot-tick` — heartbeat, dispatches due jobs, respects `emergency_stop`.
- `marketing-calendar-planner` (weekly) — walks upcoming calendar events, creates campaign drafts at each prep window.
- `marketing-trend-ingest` (daily) — provider adapter architecture: `providers/google-trends.ts`, `google-search-console.ts`, `ga4.ts`, `google-ads.ts`, `internal-search.ts`, `internal-sales.ts`. Missing credentials → provider marked unavailable, never fabricate.
- `marketing-campaign-builder` — scores candidate products (0-100, 8 weighted dims), assigns roles, requires 2 external OR 1 external + strong internal OR strong internal-only.
- `marketing-bundle-builder` — real matcher (8 weighted dims, dedupe by content hash, quality parity, age-band overlap). Composes bundle hero graphic from existing verified covers (no new AI art).
- `marketing-pricing-controller` (daily, cooldown-gated) — switchback price tests, movement caps, diagnose low-conversion path (never auto-drop regular for low traffic).
- `marketing-campaign-activator` / `-expirer` (hourly) — transitions with idempotency lock; expirer reverts effective_price to regular.
- `marketing-metrics-rollup` (daily) — refreshes MVs.
- `marketing-attribution-sync` — joins `marketing_events` + `paid_orders` → `attribution_touchpoints`.
- `marketing-campaign-evaluator` (post-campaign) — computes incremental lift vs baseline / holdout, writes `actual_lift`.
- `marketing-learning-updater` — bounded weight updates, versioned.
- `marketing-emergency-stop` — one call halts all marketing jobs, reverts campaign prices, preserves book pipeline.
- `track-commerce-event` — validated public ingest, rate-limited, hashed session IDs, respects consent.
- `payments-webhook` (new) — Stripe webhook → `paid_orders` with dedup on `provider_txn_id`.

Scheduling via `pg_cron` + `pg_net` (project already uses this pattern).

---

## Phase 4 — Admin Marketing Command Center

Route: `/admin/marketing-autopilot` with tabs Overview / Campaign Calendar / Active Campaigns / AI Decisions / Pricing / Bundles / Experiments / Product Performance / Attribution / Geography / Trend Radar / Settings / Audit Log.

- Master + subsystem toggles, mode selector, Emergency Stop.
- "What AI is doing now" panel with evidence sources, guardrail pass/fail, rollback condition.
- Product analytics table with real funnel + campaign perf.
- Geography dashboard (US-first; schema country-scoped for future markets).
- Campaign result view distinguishes gross revenue vs **incremental contribution profit**.
- All numbers marked "Not Available — payment tracking not verified" until `paid_orders` has data.

---

## Phase 5 — Storefront campaign surfaces + checkout consistency

- Dynamic surfaces: kids hero campaign, announcement bar, seasonal rail, "Trending Now", "Perfect for [event]", bundle rail, bestseller rail, new release rail, PDP cross-sell, cart upsell, checkout upsell, post-purchase offer.
- Route: `/kids/campaign/:slug` with real dates, SEO title/meta, JSON-LD Offer schema, no fake urgency, no fake reviews.
- Countdown component reads real `campaigns.ends_at`; hides on expiry, no reset.
- Checkout: server-side resolver call locks a price snapshot for a limited checkout window; snapshot verified in webhook.
- GA4 dataLayer contract: full items[] with promotion_id/name, item_list_id/name, coupon, price, quantity, transaction_id, value, currency. Ads conversion dedup by transaction_id.

---

## Phase 6 — Experiments + learning + safety monitors

- Experiment engine (switchback for price, holdout for creative). Min windows/samples/confidence enforced; novelty guard for holidays.
- Auto-pause monitors (checkout errors, webhook health, dedup anomalies, refund spike, price mismatch, ROAS floor, campaign price < floor, ad cap exceeded, stale data). Pause reverts to last valid regular price, logs decision, alerts, never touches book pipeline.
- Learning updater: bounded weight deltas, version-pinned, guardrail rules immutable to AI.

---

## Test matrix (all in Phase's own PR)

Every assertion in §22 becomes a vitest case. Plus:
- Idempotent campaign activation (double-invoke → single row change).
- Bundle dedupe rejects near-duplicate content.
- Emergency Stop halts marketing jobs but book-generation cron continues.
- Same-market same-time same-SKU price invariant across 100 simulated sessions.
- Browser-reported purchase cannot create `paid_orders` row.

---

## Technical notes

- **Payments source of truth**: Real revenue requires a live Stripe webhook. Current codebase has `_shared/stripe.ts` gateway helper and sandbox webhook secret, but no wired kids-checkout webhook. Phase 5 adds `payments-webhook` edge function and points sandbox Stripe → it. Until then, Revenue/ROAS render "Not Available".
- **Google Trends / Ads / GSC / GA4 credentials**: not present in secrets. Trend engine ships with providers marked `unavailable`; internal-search + internal-sales providers work day one. I'll list the exact secrets needed to enable each external provider in the completion report.
- **RLS**: every new table locked to `service_role` + `has_role(auth.uid(),'admin')`; `marketing_events` accepts inserts only through `track-commerce-event` edge function (anon insert denied at table level).
- **Isolation**: dedicated `MARKETING_AUTOPILOT_*` flags, `marketing_settings.emergency_stop`, and job-name prefixes (`marketing-*`) mean nothing here can affect `coloring-v2-autopilot`, `kids-*`, or any QC gate.
- **Backward compatibility**: legacy `coloring-repricer` cron stays scheduled but exits early when `marketing_settings.dynamic_pricing_enabled = true`. `saleConfig` reads bridge to new resolver behind a shim.
- **Rollout**: land phases in order behind flags; production stays in `OBSERVE_ONLY` until Phase 5 ships paid_orders, then `AUTO_LOW_RISK`, then `FULL_AUTOPILOT` once experiments have real baselines.

## What ships in the first mergeable PR (Phase 0)

- Feature flags.
- Remove synthetic compare-at + fake platform reviews everywhere they render.
- New Editorial Quality badge component.
- Regression tests locking in "no fake pricing / no fake reviews".
- Written audit report at `.lovable/marketing-autopilot-audit.md`.

Subsequent phases follow the plan above, each independently reviewable.
