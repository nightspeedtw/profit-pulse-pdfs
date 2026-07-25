
## Goal

Bring every coloring product page to the owner's 8-point conversion spec, and make sure **preview images, free-sample PDFs, and marketing discounts are generated automatically for every book** — old and new — with zero admin work.

---

## Part A — Product page conversion overhaul (`src/pages/ColoringProduct.tsx`)

Rebuild the page into 8 required sections. Above-the-fold is one mobile viewport.

1. **Above the fold (hero, single screen on mobile)**
   - Large mockup of cover + one interior preview thumbnail beside/under it
   - Title (with "Coloring Book" enforced), price with strikethrough + discount %
   - "⚡ Instant Download" line
   - Primary CTA button: `Get Your Coloring Book — $X.XX`
   - Trust line under button: `A4 + US Letter • Print Again Anytime`

2. **"What you get" block** — new `<WhatYouGetList />` with fixed schema:
   - `40 unique coloring pages` (read from `metadata.interior_page_count` or default)
   - `Ages 4–8` (from `metadata.age_band`)
   - `PDF files: A4 + US Letter`
   - `Download instantly after payment`
   - `Personal-use license included`

3. **5-page curated preview carousel** (`<CuratedPreviewCarousel />`)
   - Auto-picks 5 pages from `coloring_v2_assets` covering: cover / easy / detailed / hero scene / activity. Selection logic in new `_shared/curated-preview.ts` and cached to `ebooks_kids.metadata.curated_preview_urls`.

4. **"Why parents buy this"** — 4 fixed bullet points with icons.

5. **Bundle upsell under CTA** — reuse `BundleUpsellCard` with copy: *Love this theme? Get 3 printable coloring books and save 35%.*

6. **Bonus stack** — "You also get free: Color Reward Certificate + 5 bonus mini pages" (static, already delivered inside the PDF).

7. **FAQ accordion** — 5 fixed questions listed by owner.

8. **Related products** — 3 sibling coloring books + final CTA to bundle page. (Already partially exists; enforce 3-card row + terminal CTA.)

Remove/collapse anything that pushes trust/CTA below the fold.

---

## Part B — Auto preview + sample for EVERY book (no admin)

New edge function `coloring-storefront-assets-tick` (cron every 5 min):

For each `ebooks_kids` row where `book_type='coloring_book'` AND `listing_status='live'` AND `metadata.curated_preview_urls IS NULL`:
1. Pull interior page assets from `coloring_v2_assets`.
2. Run the curated-5 selector (`_shared/curated-preview.ts`).
3. Upload low-res watermarked JPGs to `ebook-covers/previews/<book-id>/p1..p5.jpg`.
4. Generate 4-page sample PDF via existing `generate-sample-pdf` (already exists) and store URL in `metadata.sample_pdf_url`.
5. Patch `metadata` atomically via `atomic_patch_ebooks_kids_meta`.

Also wire this step into `coloring-v2-autopilot` so new books never ship without preview + sample.

**Backfill** run once for existing ~64 live books (invoke the same function with `?backfill=1`).

---

## Part C — Marketing/discount auto-apply on new books

Root cause: `marketing-autopilot-tick` seeds pricing only when a book is inserted into `product_pricing`. New coloring books miss the insert.

Fix in `coloring-v2-autopilot` publish step:
1. On transition to `listing_status='live'`, upsert a row into `product_pricing` with `regular_cents = price_cents`, `effective_cents = round(price_cents * (1 - sitewide_discount_pct))`, `market = 'US'`.
2. Insert matching `price_history` row with `price_type='regular'` for compare-at legitimacy.
3. Emit `campaign_products` entry linking to the active sitewide campaign so `useResolvedPricing` picks it up on cards + product page.

Verify `KidsBookCard` + `ColoringProduct` both read `resolvedPrice` from `useResolvedPricing`, so once `product_pricing` is populated, discount shows automatically.

Backfill: one-off SQL patch upserting `product_pricing` + `campaign_products` for every live coloring book missing a row.

---

## Files touched

**Frontend**
- `src/pages/ColoringProduct.tsx` — restructure into 8 sections
- `src/components/product/WhatYouGetList.tsx` *(new)*
- `src/components/product/CuratedPreviewCarousel.tsx` *(new)*
- `src/components/product/WhyParentsBuy.tsx` *(new)*
- `src/components/product/ColoringFAQ.tsx` *(new)*
- `src/components/product/BonusStack.tsx` *(new)*
- `src/lib/useResolvedPricing.ts` — ensure it's called on `ColoringProduct`

**Backend**
- `supabase/functions/_shared/curated-preview.ts` *(new)* — 5-page selector
- `supabase/functions/coloring-storefront-assets-tick/index.ts` *(new)* — cron for preview + sample backfill
- `supabase/functions/coloring-v2-autopilot/index.ts` — call the tick + seed `product_pricing`/`campaign_products` on publish
- `supabase/config.toml` — register cron (5 min)

**Data**
- One-off backfill via `supabase--insert`: seed `product_pricing` + `campaign_products` for live coloring books missing rows; enqueue preview/sample generation for the ~64 existing books.

---

## Acceptance

- Any live coloring product URL shows all 8 sections, mobile-fold-complete.
- 5 curated previews load without admin action for a brand-new book within 5 min of going live.
- Free-sample modal downloads a real 4-page PDF for every live book.
- Discount % and strikethrough visible on both product page and card for every new book automatically.
