## SecretPDF Kids AI Marketing Autopilot — Phased Build Plan

Phase 0 (already shipped): removed synthetic compare-at prices + fake reviews, added `EditorialQualityBadge`, feature-flag scaffold, audit doc at `.lovable/marketing-autopilot-audit.md`.

This plan covers Phases 1–6. Marketing Autopilot is a **separate subsystem** — it never touches manuscript, artwork, PDF, QC, or the existing coloring-v2/book-generation autopilot. All existing quality gates remain untouched.

---

### Phase 1 — Pricing foundation & authoritative resolver

**Migrations**
- `marketing_settings` (singleton row): mode (`OFF|OBSERVE_ONLY|RECOMMEND_ONLY|AUTO_LOW_RISK|FULL_AUTOPILOT`), market=`US`, tz=`America/New_York`, subsystem toggles, floors ($5 regular / $1.99 single / $1.99 per-book in bundle), cooldowns (30d regular, 90d for $1.99), max move %, ROAS targets, ad budget caps, emergency-stop reason, rule_version.
- `product_pricing` (per ebook): regular_price_cents, campaign_price_cents, effective_price_cents, value_tier, value_score, active_campaign_id, valid_from/to, locked_until, rule_version, confidence.
- `price_history` append-only ledger with reason, campaign_id, experiment_id, ai_decision_id, metric snapshot, rollback_ref.
- Backfill: seed `product_pricing.regular_price_cents` from current `ebooks_kids.price_cents` (or storefrontPricing fallback), no compare-at.

**Code**
- New `supabase/functions/_shared/marketing/pricing-resolver.ts`: single server-side resolver `resolveEffectivePrice(productId, at=now)` → `{regular, campaign, effective, source, campaignId, lockedUntil}`. Uses only `product_pricing` + active `campaigns`. Never synthesizes.
- New `isCompareAtPriceLegitimate(productId, compareAtCents, campaignStartAt)` — requires ≥30 consecutive days of active regular price in `price_history`, campaign start/end, compare > effective, not permanently discounted.
- Refactor `src/lib/storefrontPricing.ts` + `supabase/functions/_shared/pricing.ts` + `_shared/coloring/pricing.ts` to consume resolver. Delete synthetic compare-at path. Compare-at only rendered when validator passes.
- Refactor `compute-pricing` and `coloring-repricer` to write through resolver + enforce cooldowns.

**Tests**: regular floor $5, bundle per-book floor $1.99, no synthetic compare-at, invalid history → no strikethrough, same-SKU same-time same-price, discounts don't stack, expired campaigns revert.

---

### Phase 2 — Campaigns, bundles, calendar

**Migrations**: `marketing_calendar_events`, `campaigns`, `campaign_products`, `bundles`, `bundle_items`, `ai_marketing_decisions`.

**Calendar seed**: generator function that emits movable US retail/cultural events per year (New Year → NYE, incl. Back-to-School, Labor Day, Halloween, Thanksgiving, BFCM, Christmas, plus optional educational observances). Initialized with Back-to-School 2026 as top priority. Prep windows: 180/90/60/45/21/7/day-of/post.

**Value scoring**: `product_value_score` deterministic scorer (QC 25 / depth 15 / art 15 / edu 15 / uniqueness 10 / readiness 10 / series 5 / demand 5) → tier → snap to allowed ladder ($5, $7.99, $9.99, … $149.99, +). Persists inputs, normalized scores, tier, price, confidence, reasons, rule_version to `ai_marketing_decisions`.

**Bundle engine**: candidate scorer (theme 25 / age 20 / type 15 / complement 15 / co-view 10 / quality 10 / readiness 5). Rejects duplicates, mismatched ages, non-live products. Generates 3/5/10-book bundles with structural savings (~10/15/20%). Bundle covers composed from existing verified book covers — no new AI art.

**Campaign selection**: hero/support/entry/anchor/bundle/cross-sell roles; excludes products failing QC, not sellable, missing PDF/cover/preview.

**Rules enforced**: no stacking, $1.99 max 24h + 90d cooldown per SKU, ≥60% full-price days in rolling 90d per SKU (with logged BFCM exceptions), real countdowns only, no fake scarcity, auto-revert on expiry.

---

### Phase 3 — Event ledger, attribution, payment source-of-truth

**Migrations**: `marketing_events` (full ecommerce event set — view_item_list … download_complete, with session, user, product, bundle, campaign, experiment, price snapshots, UTM, gclid, consent), `attribution_touchpoints`, daily rollup views/tables per product/campaign/promo/bundle/category/country/source/device/experiment.

**Ingestion**: `track-commerce-event` Edge Function — validated, rate-limited, RLS-protected, hashed session IDs, consent-aware. Client emits from `coloringFunnelEvents` + new hooks on cards/preview/cart/checkout.

**Payment adapter**: `supabase/functions/_shared/marketing/paid-order-source.ts`. **Authoritative revenue only from verified payment-provider webhook** (Stripe adapter first; extensible). Deduplicates transaction IDs, snapshots line items + campaign/promo attribution. Browser purchase events assist attribution but never create revenue rows.

**Audit output**: doc noting whether Stripe payments are live. Until verified, dashboard shows Revenue/ROAS as “Not Available — payment tracking not verified.” No mock revenue anywhere.

**GA4/GTM/Ads**: consistent dataLayer contract, items array with promotion/list/coupon/price/qty/tx/value/currency; server-side purchase conversion with dedup; ad-cost import via Google Ads API when credentials connected (else ROAS hidden).

---

### Phase 4 — Autopilot jobs + storefront surfaces

**Edge Functions (all idempotent, bounded, rollback-capable)**: `marketing-autopilot-tick`, `-calendar-planner`, `-trend-ingest`, `-campaign-builder`, `-campaign-activator`, `-campaign-expirer`, `-bundle-builder`, `-pricing-controller`, `-metrics-rollup`, `-attribution-sync`, `-campaign-evaluator`, `-learning-updater`, `-emergency-stop`.

**Cron**: events realtime; campaign health hourly; expiry hourly; trends daily; rollup daily; pricing daily (30d cooldown honored); planner weekly; calendar refresh monthly + year boundary; learning after each close + weekly.

**Pricing controller**: switchback time-block A/B for public price tests (never secret per-user prices). Increase eligibility: ≥500 views or ≥30 orders + conv ≥ category median + RPV ≥ prior + healthy refunds + no active deep discount. Decrease diagnosis tree (visibility vs merchandising vs price) before any regular-price cut.

**Trend engine**: provider adapters (Google Trends, GSC, GA4, Google Ads, internal search/zero-result/views/orders, approved public APIs). No scraping. `trend_signals` table. FULL_AUTOPILOT campaign requires 2 external OR 1 external + strong internal OR strong internal with sample. Missing providers marked unavailable — never fabricated.

**Storefront surfaces (data-driven from active `campaigns`)**: kids hero campaign, announcement bar, seasonal rail, Trending Now rail, “Perfect for [event]”, bundle rail, bestseller rail, new-release rail, PDP cross-sell, cart/checkout upsell, post-purchase offer, `/kids/campaign/:slug` landing pages. All expire automatically.

**Checkout consistency**: server-side price lock snapshot at `begin_checkout`; card/PDP/cart/checkout/provider/order/receipt/GA4/Ads all use resolver output. Browser-submitted price never trusted.

---

### Phase 5 — Admin Marketing Command Center

Route `/admin/marketing-autopilot` — tabs: Overview, Calendar, Active Campaigns, AI Decisions, Pricing, Bundles, Experiments, Product Performance, Attribution, Geography, Trend Radar, Settings, Audit Log.

Overview: status, mode, next run, active/upcoming campaigns, AI confidence, expected vs actual lift, revenue today (or “Not Available”), orders, conv, AOV, RPS, contribution profit, ad spend, Revenue ROAS, Profit ROAS, CAC, refund rate, full-price share, discount dependency, alerts, “What AI is doing now” (holiday chosen, why, evidence, SKUs, prices, expected result, confidence, guardrails, next eval, rollback condition).

Master + subsystem toggles: Marketing Autopilot, Dynamic Regular Pricing, Seasonal, Flash Sales, Bundle Builder, Merchandising, Email Automation, Trend Discovery, Experiment Engine, Paid Ads Autopilot (locked until purchase tracking verified + admin sets caps + ROAS target), Emergency Stop. Book-generation autopilot toggle stays separate and untouched.

---

### Phase 6 — Experiments, learning, safety

- `marketing_experiments` with switchback for price, holdout baselines, defaults: ≥7d, ≥500 qualified sessions (configurable), ≥30 purchases for price conclusions, ≥95% confidence, ≥5–10% meaningful lift.
- Post-campaign learning writes to `ai_marketing_decisions` + bounded weight updates (versioned, cannot rewrite safety guardrails).
- Auto-pause triggers: checkout/download error spikes, webhook unhealthy, tx dedup breach, refund spike, price below floor, invalid compare-at, invalid dates, ad-cap breach, Profit ROAS below threshold after min sample, conv collapse, price mismatch across surfaces, product unavailable, stale/contradictory data. On pause: revert to last valid regular price, remove countdowns, stop new ad spend, preserve orders, log alert + AI decision. Never touches book pipeline.

---

### Technical details

- All tables: RLS on; admin-only reads for reports/settings; service-role only for price/campaign writes; GRANTs per project rules; append-only history tables.
- `marketing_settings.rule_version` bumped on any rule change; every decision stamps rule_version.
- All jobs idempotent via natural keys (campaign slug + market + start; price change (product, effective_from)).
- Feature flags default OFF; existing storefront behavior unchanged until Phase 1 resolver merged.

**Definition of done** = spec §23 checklist, with ROAS/revenue only shown when verified end-to-end paid data exists.

**Delivery order**: Phase 1 → 2 → 3 → 4 → 5 → 6, each phase merged with tests + migrations before the next starts. Approve to begin Phase 1.
