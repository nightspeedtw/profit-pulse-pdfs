# Marketing Autopilot — Audit (Phase 0)

**Scope:** storefront pricing, sale copy, reviews, funnel events, admin
pricing surfaces, payment source-of-truth. Book-production, QC, PDF, and
cover systems are **out of scope** and are not touched by this work.

## Findings

### 1. Synthetic compare-at prices (FIXED in Phase 0)
`src/lib/storefrontPricing.ts` previously synthesized a deterministic
"original" price in the 55–70% off band per book id when no real
`compare_at_price_cents` existed. Every card on the kids storefront
therefore rendered a fake strikethrough + fake "% off" chip.

**Fix (this PR):** `deriveSalePricing` returns `hasDiscount=false` unless
storefront meta carries BOTH an explicit `compare_at_price_cents` (or
legacy `pricing.compare_at_cents`) AND a `compare_at_verified === true`
sentinel written server-side by a downstream validator. Phase 2 will
implement the validator (`price_history` ≥30 consecutive full-price days,
no permanent-discount pattern, valid campaign timestamps, compareAt >
effective).

### 2. Fabricated customer-review counts (FIXED in Phase 0)
`derivePlatformReview` returned `{ average: 5.0, count: 12–60 }` per
deterministic hash of the book id. `KidsBookCard` and `ProductRating`
rendered these as star ratings with a "(37)" count that looked like real
customer reviews.

**Fix (this PR):** `derivePlatformReview` is now an "unavailable" shim.
`KidsBookCard` and `ProductRating` render `<EditorialQualityBadge />`
(QC passed · Verified PDF · Age-checked) instead — checkmarks, not stars.
Real ratings from `product_review_stats` still take over automatically
once a book has genuine customer reviews.

### 3. Legacy sitewide sale toggle
`src/lib/saleConfig.ts` reads `platform_settings.storefront_sale_config`.
Keep as-is for now; Phase 2 will migrate readers to the new campaign
resolver and Phase 3 will retire this key.

### 4. Coloring funnel events
`src/lib/coloringFunnelEvents.ts` emits 4 event types to
`coloring_book_events` via anon RLS. Keep. Phase 3's `track-commerce-event`
edge function will subsume it via a compatibility writer that dual-writes
to the new `marketing_events` ledger.

### 5. Coloring repricer
`supabase/functions/coloring-repricer/index.ts` +
`_shared/coloring/pricing.ts` implement a daily popularity-only repricer
with no cooldown, no experiment, no floor beyond `ceiling_cents`. Freeze
for now; Phase 3's `marketing-pricing-controller` supersedes it. The cron
job will short-circuit once `marketing_settings.dynamic_pricing_enabled`
is true.

### 6. Adult-ebook pricer
`supabase/functions/compute-pricing/index.ts` +
`_shared/pricing.ts` price `ebooks` (not kids). Out of scope; untouched.

### 7. Payments source of truth
`_shared/stripe.ts` exists (gateway-only) and `PAYMENTS_SANDBOX_WEBHOOK_SECRET`
is present, but there is **no wired kids-checkout webhook**. Free downloads
and click-buy events must NOT be counted as paid revenue. Until Phase 5
ships `payments-webhook` + `paid_orders`, the Marketing Command Center must
render Revenue / ROAS / lift as **"Not Available — payment tracking not
verified"**.

### 8. Admin surfaces
`src/pages/admin/AutopilotControl.tsx`, `Dashboard.tsx`,
`PricingPanel.tsx` remain untouched. New route `/admin/marketing-autopilot`
will live beside them (Phase 4).

## Phase 0 shipped

- `src/config/features.ts` + `supabase/functions/_shared/features.ts`:
  `MARKETING_AUTOPILOT` (default OFF), `MARKETING_HONEST_PRICING` (ON),
  `MARKETING_HONEST_REVIEWS` (ON).
- `src/lib/storefrontPricing.ts`: synthesis removed; new
  `deriveEditorialQuality`; `derivePlatformReview` shim.
- `src/components/product/EditorialQualityBadge.tsx`: new component.
- `src/components/kids/KidsBookCard.tsx` +
  `src/components/product/ProductRating.tsx`: consume badge, drop fake stars.
- `src/__tests__/marketing-honest-pricing-and-reviews.test.ts`: regression.

## Phase roadmap
See `.lovable/plan.md`. Phases 1–6 (data model → jobs → admin → storefront
surfaces → experiments/safety) land in subsequent turns, each behind flags,
each independently reversible, none touching book-production.
