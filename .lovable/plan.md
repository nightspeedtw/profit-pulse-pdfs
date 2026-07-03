# Auto-list ready ebooks + world-class covers (native only)

## Goal
Drop Shopify from the pipeline for good. When an ebook is "ready", the platform auto-lists it as a product with category and a properly generated thumbnail cover following the `world-class-cover-designer` skill.

## What "ready" means (please confirm)
Current `ebooks.status` values in your DB: `needs_review`, `cover`, `review`, `ready_for_qc`, `published`. I'll treat **`ready_for_qc` (or manual "Approve")** as the trigger to auto-list. Confirm or tell me which status should trigger listing.

## Changes

### 1. Activate the cover skill
- Apply `.agents/skills/world-class-cover-designer` as an active workspace skill so the pipeline uses it as the enforced creative director.
- `supabase/functions/generate-cover` is updated to follow it verbatim:
  - Build a `CoverSpec` first (avatar, pain, lever, metaphor, palette, layout).
  - Prompt image model for a **textless** background only.
  - Overlay title/subtitle/brand server-side via SVG → PNG (using Fraunces / GT-style serif for finance/authority; geometric sans for systems).
  - Run QC gates (thumbnail legibility ≥90, anti-AI ≥90, textless =100). Regenerate up to 2 times on gate failure.
  - Write final `cover_url` + a 400px `thumbnail_url` to `ebook-covers` bucket.

### 2. New auto-list edge function `auto-list-ebook`
Given an `ebook_id`:
1. Verify the ebook has: PDF asset, `cover_url`, `price > 0`, `category_id`, `title`.
2. If cover missing or flagged low-quality → call `generate-cover` first.
3. Create/refresh Stripe Product + Price via lookup_key `ebook_<uuid>_price` (tax_code `txcd_10504003`, e-books). Managed payments already on at checkout.
4. Set `ebooks.listed_at = now()`, `status = 'published'`.
5. Log to `pipeline_step_logs`.

### 3. Auto-trigger
- Database trigger on `ebooks` update: when `status` transitions to the ready value AND `listed_at IS NULL`, enqueue a call to `auto-list-ebook` via `pg_net`.
- Manual "List for sale" button in `LiveProductionQueue` keeps working (calls same function).

### 4. Categories
- Every ebook already has a `category_id`. `list-storefront` already joins categories. No schema change needed — just surface the category on the product card and product page if not already.

### 5. Kill Shopify from the live path
- Remove Shopify buttons/links from admin UI render tree (files kept in `_archive/`).
- `SHOPIFY_UPLOAD` feature flag stays `false`; remove any code path that still calls `push-to-shopify` or `generate-shopify-package`.

## Files touched
- `supabase/functions/generate-cover/index.ts` — rewrite to skill contract
- `supabase/functions/_shared/cover.ts` — CoverSpec builder + typography overlay
- `supabase/functions/auto-list-ebook/index.ts` — **new**
- `supabase/migrations/…_auto_list_trigger.sql` — status→listing trigger
- `src/components/admin/LiveProductionQueue.tsx` — wire "List for sale" to `auto-list-ebook`; hide Shopify controls
- `.workspace/skills/world-class-cover-designer/` — activate via `skills--apply_draft`

## Out of scope
- Rewriting existing published covers (only regenerated on demand or when status flips fresh).
- Subscriptions, coupons, bundles.

## Confirm before I build
1. Trigger status = **`ready_for_qc`** (auto) with a manual override button — OK?
2. Regenerate covers for the ebooks that already have `cover_url` set (e.g. the 3 currently listed / in review), or only for new ones?
