## What's actually wrong

The current cover code (`coloring-v2-cover` + `premium_cover_overlay_v4_no_popups`) already draws **no** top chip, **no** bottom banner, and **no** SALE ribbon. The problem is that all 6 live V2 covers on the storefront were baked earlier with the previous overlay `premium_cover_overlay_v3_age_in_chip`, which drew exactly the yellow "COLORING BOOK · AGES 13-17" chip, the diagonal SALE ribbon, and the dark bottom "A race against the city's digital heart" banner that the user circled. That artwork is now static JPEG bytes on Supabase Storage.

Confirmed by DB:

| Book | Overlay provenance stored | Age band |
|---|---|---|
| Busy Block ABCs | `premium_cover_overlay_v3_age_in_chip` | 2-4 |
| Mighty Dino March | `premium_cover_overlay_v3_age_in_chip` | 4-6 |
| Mucky Boots Barnyard | `premium_cover_overlay_v3_age_in_chip` | 2-4 |
| Mythic Marvels | `premium_cover_overlay_v3_age_in_chip` | 6-8 |
| Cyber City Countdown | `premium_cover_overlay_v3_age_in_chip` | 13-17 |
| Soulful Symmetry | `premium_cover_overlay_v3_age_in_chip` | 13-17 |

So this is **half a code fix + half a data backfill**. The user is right that it needs to be permanent: today's cover code is clean, but there's nothing that stops stale-overlay JPEGs from staying live forever, and there's no defense if a future overlay change happens again.

## Permanent fix (code, coloring lane only, scope-guarded to `book_type='coloring_book'`)

### 1. Canonical "no-popups" contract

- Freeze the current overlay behavior in a named contract constant `COVER_OVERLAY_CONTRACT = 'no_popups_v4'` inside `supabase/functions/_shared/coloring/premium-cover-overlay.ts`.
- Export a boolean helper `overlayIsCurrent(meta)` that returns true only when `meta.overlay === 'premium_cover_overlay_v4_no_popups'`.
- Add a unit-style assertion at module import time: the overlay function must NOT reference `topLabel`, `subtitle`, `blurb`, `ribbonText`, or any chip/banner SVG. If a future edit re-introduces them, a build-time regression test fails.

### 2. OCR gate hardens the ban list

Extend `verifyExactCoverText` (`_shared/coloring/cover-text-transcription.ts`) so that in `title_only` mode any of these tokens in the Ideogram bake force a reject even if they visually "look right":

- `SALE`, `NEW`, `FREE`, `BEST`, `BONUS`
- `COLORING`, `BOOK`, `AGES`, `AGE`, `PAGE`, `PAGES`
- `LOOK INSIDE`, `INSIDE`
- any digit run that isn't in the title
- any run of >2 characters that isn't a title token

That guarantees Ideogram can never sneak the very chip/ribbon words back onto a future cover.

### 3. Storefront-side legacy guard

In `coloring-v2-autopilot` (already runs on a cron), add a **legacy-cover sweep** phase that runs before it picks up new books:

- Query every live coloring V2 book whose `approved_cover_asset_id.meta->>'overlay' <> 'premium_cover_overlay_v4_no_popups'`.
- For each match, roll the book back to `stage = 'cover'`, clear `approved_cover_asset_id`, and fire `coloring-v2-cover` to re-bake with the current clean overlay.
- Cap at 5 rebakes per autopilot tick to respect the paid-ceiling law.

This means from now on any cover that drifts from the current no-popups contract self-heals on the next autopilot tick — no manual DB edits ever needed again.

### 4. Product page audit

Read `src/pages/ColoringProduct.tsx` and `src/components/kids/KidsBookCard.tsx` end-to-end and confirm neither draws any HTML text on top of the cover image. Grep already shows no matches for "COLORING BOOK", "AGES", "LOOK INSIDE", or "SALE" strings rendered over the cover — but I'll re-verify inside the plan-mode read before touching anything so the fix is scoped correctly.

Note: the small floating "Look Inside" button visible in the screenshot is a real interactive `<button>` on the product page's gallery card, not baked artwork. The user's red circle appears to be highlighting it as part of the same complaint. It will be moved out of the image overlay area and placed under the gallery so nothing floats on top of the cover anymore.

## One-shot data fix (this run only)

Once the code above is in, run the legacy-cover sweep manually for the 6 books listed above so the user sees clean covers immediately instead of waiting for the next autopilot tick:

1. `UPDATE coloring_v2_books SET stage='cover', approved_cover_asset_id=NULL WHERE id IN (...6 ids...)`.
2. Fire `coloring-v2-cover` for each id (fire-and-forget, in parallel, respecting the 5/tick paid-ceiling).
3. Poll until `stage='publish'` for all 6.
4. The idempotent `ebooks_kids.coloring_v2_book_id` upsert bridge from the earlier fix will update the storefront rows in place — no duplicates.

## Verification

- Read the storefront with Playwright at `/kids` and at `/kids/coloring/<each of the 6 ids>` and screenshot each cover.
- Assert visually and via OCR that none of the six covers contains the words `SALE`, `COLORING BOOK`, `AGES`, or the bottom description banner.
- Confirm `coloring_v2_assets.meta->>'overlay' = 'premium_cover_overlay_v4_no_popups'` for all six new cover assets.
- Confirm no "Look Inside" or any other button is rendered on top of the cover image on the product page.

## Non-goals

- No changes to picture-book / novel / adult-PDF pipelines (scope-guarded).
- No changes to interior pages, matter pages, PDF assembly, pricing, or age-band logic.
- No new UI features on the product page — this is a pure removal + backfill.
