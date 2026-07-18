
# Etsy-Grade Sale Page + Autonomous Promotion Engine

Two workstreams built as one coherent system. Stage A ships a visible win on the test book; Stage B lands the engine + admin panel; Stage C wires storefront surfaces to it.

---

## Stage A — Sale page upgrade (`/kids/coloring/:id`, verify on `c2839b88` "Fierce Floral")

**Goal:** Match QuirkyFindsPH gallery caliber with honest metrics and real countdowns.

### A1. Gallery lineup (branded cards, code-rendered text, spelling-gated)
Composited cards rendered as PNG at assemble time (reuse existing marketing-thumbnail infra), stored in `ebook_assets` and surfaced in the product gallery in this order:
1. **Cover mockup hero** (existing).
2. **"COLORING SAMPLES" grid card** — 6 interior pages on brand background, page numbers.
3. **"COLORED IN DIFFERENT MEDIUMS" card** — same interior page rendered 3× (colored pencil / marker / crayon) via Runware img2img on one line-art page. Cached per book.
4. **"WHAT YOU GET" card** — PDF + JPEG ZIP + page count + trim + print-ready icons.
5. **"HOW IT WORKS" card** — 3-step (buy → instant download → print).

Add helper `_shared/coloring/gallery-cards.ts` + edge fn `coloring-gallery-cards` invoked from the publish pipeline. All text rendered via server-side SVG → PNG (no model-baked text), passed through the existing spelling gate.

### A2. Dual deliverable: PDF **and** per-page JPEG ZIP
- New step in `kids-build-picture-pdf` (coloring path): after PDF assembly, pack interior page PNGs → JPEG @ 300 DPI → `pages.zip`. Upload to `ebook-pdfs` bucket.
- Extend `download_grants` / `kids_download_grants` to include a second signed URL `zip_url`.
- `download-ebook` edge fn returns both.
- Sales copy: "Instant download — high-res PDF + per-page JPEG ZIP".

### A3. Honest trust-metrics block (Etsy-style)
New `TrustMetricsBlock.tsx`. When no real reviews:
- "5.0 · SecretPDF editorial QC"
- "5.0 · File quality (print-ready verified)"
- "100% · QC gates passed"
- Tooltip: platform quality review, will be replaced by buyer metrics as they arrive.
When `product_review_stats.count > threshold`: swap to real "Item quality / Service / Recommend %" derived from reviews.

### A4. Real urgency only
- `<PromoCountdown>` reads the book's active `promo_windows` row and counts down to its real `ends_at`. If no window → hide.
- Omit "X in carts" entirely until real cart telemetry exists (documented as future).

---

## Stage B — Promotion autopilot engine

### B1. Schema (migration)

```text
promo_windows        one active row per book at a time
  id, book_id, book_type ('coloring'|'picture'|'adult'),
  kind ('rotation'|'flash'|'boost'|'core'),
  discount_pct, sale_price_cents, anchor_price_cents,
  starts_at, ends_at, active bool,
  source ('autopilot'|'manual'), created_by

promo_rules          singleton config (JSONB)
  discount_bands {min,max}, cycle_days {min,max},
  flash_per_type {coloring,picture,adult},
  margin_floor_cents, boost_threshold {sales, days},
  charm_endings [.99,.73,.49], autopilot_enabled bool

promo_events         audit trail
  id, book_id, event ('window_open'|'window_close'|'reprice'|
    'flash_selected'|'boost_enter'|'boost_exit'|'core_lock'),
  before_cents, after_cents, discount_pct, window_id,
  reason text, created_at

ebooks_kids / ebooks additions:
  anchor_price_cents  (set ONCE at first publish; never overwritten)
  core_promo bool     (manual-promo lock; excludes from autopilot)
  bestseller_rank int (nullable)
  velocity_score numeric
```

All tables: GRANT to authenticated + service_role, RLS: public SELECT on `promo_windows` where active, admin-only writes.

### B2. Engine (`promo-autopilot` edge fn, cron every 15 min)
For each `book_type`:
1. **Close expired windows** → log `window_close`, restore base sale or open next.
2. **Rotation**: books with no active window (and `core_promo=false`) get a new window: discount ∈ [band.min, band.max], length ∈ [cycle.min, cycle.max] days, both jittered per book. Compute `sale = max(anchor*(1-d/100), margin_floor)` then snap to nearest charm ending. Skip if snap would violate floor.
3. **Flash-of-the-day** (00:00 UTC daily job piggybacked on same cron): pick N random eligible books per type, override with deep discount, `ends_at = next midnight`.
4. **Bestseller ranks**: recompute from `book_sales_ledger` (fallback `coloring_book_events` views), write `bestseller_rank`.
5. **Slow-mover boost**: books with sales < threshold after N days since publish → enter `kind='boost'` window (deeper discount, "Hidden Gems" rail). Auto-exit when velocity recovers.
6. **Core-promo exclusion**: enforced in the SELECT (`WHERE core_promo=false`) — impossible to double-book.

Every mutation writes `promo_events`. Digest logs a summary line.

### B3. Admin surface
- **`/admin/promotions/autopilot`** — master toggle, rule tuner (bands, cycle range, flash counts, margin floor, boost thresholds), live table of active windows, recent events feed.
- **`/admin/promotions/manual`** — CORE promos: pick books, set discount + window, saves with `source='manual'` and flips `core_promo=true`. On expiry, cron flips it back.
- Both use `PricingPanel` patterns; live preview of charm-snapped price.

### B4. Sale-price wiring
Replace `deriveSalePricing` synthesis fallback with a lookup:
1. If active `promo_windows` row → use its `sale_price_cents` + `anchor_price_cents`.
2. Else fall back to current deterministic synthesis (kept as safety net).
`list-storefront` fn joins active windows. Cards + product page display real discount %, real countdown, and (when applicable) "Flash Deal" / "Best Seller" / "Hidden Gem" badges.

### B5. Storefront surfaces
- Homepage "Today's Flash Deals" strip (3 per type).
- Category page "Best Sellers" rail (top 8 by rank).
- Category page "Hidden Gems" rail (active boost windows).
- Product page badges + countdown from A4.

---

## Guardrails (enforced in code, not just docs)
- **Anchor immutability**: DB trigger blocks `UPDATE anchor_price_cents` once set.
- **No fake countdowns**: `<PromoCountdown>` requires a real `promo_windows.ends_at`; renders nothing otherwise.
- **No overlap**: `promo_windows` has partial unique index `(book_id) WHERE active`. Engine SELECT excludes `core_promo=true`.
- **Margin floor**: engine rejects any computed price < floor before insert.
- **Full audit**: every mutation → `promo_events` row.

---

## Delivery order & verification per stage

| Stage | Ships | Verify on |
|---|---|---|
| A1 gallery cards | new cards visible in product gallery | `/kids/coloring/c2839b88` |
| A2 JPEG ZIP | download returns PDF + zip_url | download flow on Fierce Floral |
| A3 trust block | honest metrics render | product page |
| A4 countdown | shows only when window exists (nothing yet — proves the guardrail) | product page |
| B1 schema | migration approved | admin |
| B2 engine + cron | first rotation writes windows + events | admin events feed |
| B3 admin panels | toggle + tune + manual promos | `/admin/promotions/*` |
| B4 sale-price wiring | product cards show engine prices | `/kids/coloring`, product page |
| B5 rails | flash / bestseller / hidden gems rails render | homepage + categories |

---

## Technical notes
- Reuse `_shared/coloring/pricing.ts` for charm-ending + floor helpers; extend, don't fork.
- Cron: single 15-min `promo-autopilot` schedule via `pg_cron` + `pg_net`; midnight flash-selection detected inside handler by UTC boundary check (no second schedule needed).
- Mockup-medium image caching keyed by `(book_id, page_id, medium)`; only regenerate on cache miss.
- Charm endings applied after floor check to avoid re-crossing the floor.
- Existing `deriveSalePricing` becomes fallback only; primary source is engine.
- No changes to Shopify / royalty / exchange code (P0 boundary respected).

---

## Assumptions (flagging for correction)
- "Different mediums" card renders **one representative page** in 3 media, not every page (cost control). Correct me if you want all pages.
- Flash-of-the-day count defaults to **3 per type** as spec'd; adjustable via `promo_rules`.
- Anchor price = the price at first `listing_status='live'` transition. Books already live get anchor backfilled from current `price` on migration.
- Cart-adds telemetry is out of scope this round; "X in carts" element stays hidden until we add cart tracking.

Approve and I'll execute Stage A immediately, then B in one migration + engine push, then C wire-up.
