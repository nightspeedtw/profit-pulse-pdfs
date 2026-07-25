## Goal
Swap the live "Bouncy Bubble Letters Coloring Book" (v2 book `e2b5a66b…`, storefront row `24a7e82b…`) so it uses the newer cover PNG the owner linked (`cover_final-c33d614b714b.png`, asset `38062c45-5848-494d-b20f-e7f820c0490e`) instead of the older approved one (`cover_final-101336a3448a.png`, asset `678fbeca…`).

## Current state (verified)
- `coloring_v2_books.approved_cover_asset_id` = `678fbeca…` (older cover)
- Newer asset `38062c45…` exists in `coloring_v2_assets` (kind `cover_final`, created 2026-07-24 10:53:51, 80 min after the older one) but is not approved
- Storefront `ebooks_kids.cover_url` and `thumbnail_url` both point at `ebook-covers/v2/bouncy-bubble-letters-coloring-book-e2b5a66b.jpg` (bridged JPG from the older approval)
- Final PDF (`0ef43361…`) was built from the older cover, so page 1 still shows the old artwork

## Plan
1. **Re-approve the newer cover asset** — Trigger a small edge-function call (or a one-shot script under `supabase/functions/coloring-v2-swap-cover/` invoked once) that:
   - Sets `coloring_v2_books.approved_cover_asset_id = 38062c45…` for book `e2b5a66b…`.
   - Downloads the newer PNG from `coloring-v2/…/cover_final-c33d614b714b.png`, converts to JPG at storefront dimensions, and re-uploads to the same storefront key `ebook-covers/v2/bouncy-bubble-letters-coloring-book-e2b5a66b.jpg` (overwrite) so every cached signed URL keeps working.
   - Regenerates the thumbnail (`ebook-covers/v2/bouncy-bubble-letters-coloring-book-e2b5a66b-thumb.jpg` if it exists in `coloring_v2_storefront_packages`).
2. **Rebuild the final PDF's page 1** — Enqueue `coloring-v2-assemble-pdf` (or the existing PDF-rebuild edge function) so page 1 uses the newer cover bytes; keep the same `final_pdf_asset_id` slot so the download link stays stable.
3. **Verification** — After the swap:
   - `SELECT approved_cover_asset_id FROM coloring_v2_books WHERE id=…` returns `38062c45…`
   - Fetching the storefront `cover_url` returns the newer artwork
   - Front-end product page renders the new cover (Playwright screenshot of `/coloring-books/bouncy-bubble-letters-coloring-book-e2b5a66b`)
4. **Preserve evidence** — Do not delete the old cover asset row. Leave `678fbeca…` in `coloring_v2_assets` as history and log the swap into `coloring_book_events` (`event_type='cover_manual_repoint'`, meta with from/to asset ids) so audit trails stay intact.

## Out of scope
- Not touching V2 book `9e70db5f…` (the other bouncy-bubble book still in `interior_render`)
- Not changing the cover-generation logic or style rotation — the rotation change from the last turn stays as-is
- Not modifying any other live book's cover

## Technical notes
- `coloring_v2_assets` rows carry `storage_path` relative to the `coloring-v2` private bucket — signed URL creation uses the standard 100-year token pattern already in use elsewhere
- Storefront JPG uses `sharp`/canvas conversion identical to what `coloring-v2-publish` already does; reuse that helper instead of reimplementing
- Because `ebooks_kids` has an `identity_guard`, we only touch `cover_url`/`thumbnail_url` (both allowed to change post-live) — never `title`, `manuscript_md`, or `story_bible`
