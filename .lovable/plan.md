# Fix: Product page shows business title instead of Barnaby's kids book

## Problem
For ebook `bcbb9b53-...` the product page shows **"The High-Ticket Consultant's Engine"** with subtitle *"A Framework for Building a Six-Figure Solo Practice..."* — even though the cover, description, category, and `seo_title` are all correctly the kids book *"Barnaby's Wobbly Problem"*.

Root cause: when an idea gets converted to a kids picture book mid-pipeline, the final children's title is only written to `shopify_title` / `seo_title`, while the original `title` / `subtitle` columns still hold the business-book idea from step 1. The storefront reads `ebooks.title`, so it displays the stale value.

Confirmed in DB for this row:
- `title` = "The High-Ticket Consultant's Engine"
- `subtitle` = "A Framework for Building a Six-Figure Solo Practice…"
- `shopify_title` = "Barnaby's Wobbly Problem"
- `shopify_subtitle` = "Sometimes, the best things are a little bit messy."
- `seo_title` = "Barnaby's Wobbly Problem — Illustrated Picture Book for Ages 4-7"

## Fix (two parts)

### 1. Backfill this row (and any similar kids rows)
One-shot SQL migration: for every ebook where `kids_visual_bible IS NOT NULL` AND `shopify_title IS NOT NULL`, set
- `title = shopify_title`
- `subtitle = COALESCE(shopify_subtitle, subtitle)`

This immediately corrects the Barnaby product page and any other kids book in the same state.

### 2. Prevent regression in the pipeline
In `supabase/functions/generate-shopify-package/index.ts` (the step that currently writes `shopify_title` / `shopify_subtitle`), when the ebook is a kids picture book (`kids_visual_bible` present OR `isKidsPictureBook(...)` true), also update `title` and `subtitle` on the ebook to match the finalized children's title/subtitle. Non-kids books are unaffected.

This keeps a single source of truth (`ebooks.title`) so the storefront, cover overlay, Look Inside, and PDF header all stay in sync with the actual book.

## Verification
- Reload `/product/bcbb9b53-…` — header must read "Barnaby's Wobbly Problem".
- Query: for any row with a kids visual bible, `title` must equal `shopify_title`.
- Regenerate a new kids book end-to-end: after the shopify-package step, the storefront row shows the kids title, not the seed idea title.

## Files touched
- New migration in `supabase/migrations/` (UPDATE statement, no schema change).
- `supabase/functions/generate-shopify-package/index.ts` (add title/subtitle to the update payload when kids book).

No frontend changes, no new dependencies, no cover regeneration needed.
