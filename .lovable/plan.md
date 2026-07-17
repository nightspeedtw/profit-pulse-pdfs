## Goal
Make three coloring-book cover/thumbnail rules permanent and gated, then apply the re-render pass to every currently-live coloring book.

## Rule 1 — Baked-title only (no overlay), enforced

Current state: `coloring-book-cover/index.ts` has TWO accepted paths:
- Tier-1 "ideogram integrated" → baked title, no overlay (correct)
- Tier-2/rung-2 "textless_art_plus_svg_overlay" → composites an SVG title layer on top (violates owner's rule)

Changes:
- Remove the `textless_art_plus_svg_overlay` acceptance branches from `coloring-book-cover/index.ts`. Any cover that fails the integrated-typography verdict goes back through the integrated ladder or is flagged for regeneration — never falls back to overlay compositing.
- Delete/quarantine the compositor call site (keep the file for the adult-ebook line but stop invoking it from the coloring path). Mark `_shared/coloring/coloring-cover-compositor.ts` as adult-only via export guard `assertNotColoring()`.
- Extend `_shared/coloring/coloring-cover-proof.ts` with a `assertNoDoubleText()` check: if `typographySource !== "ideogram_integrated"` OR proof metadata contains `overlay_applied: true` → hard fail with reason `double_text_forbidden`.
- Add hard-fail entry `double_text` to `gates.ts` `hard_fail` map.
- New test `src/lib/coloringCoverBakedTitleOnly.test.ts` covering: overlay path rejected, integrated accepted, double-text metadata rejected.

## Rule 2 — 8.5×11 trim lock everywhere

Current: cover master is `1600×2071` (ratio 0.7725, off by 0.05% from 8.5:11 — acceptable). PDF page is 612×792pt (exact). Interior renderer needs audit.

Changes:
- Add `_shared/coloring/trim-lock.ts` exporting `COLORING_TRIM = { widthIn: 8.5, heightIn: 11, pdfPtW: 612, pdfPtH: 792, coverPxW: 1600, coverPxH: 2071, interiorPxW: 1600, interiorPxH: 2071, ratio: 8.5/11, tolerance: 0.01 }` and `assertColoringTrim(kind, w, h)`.
- Wire `assertColoringTrim` into: `coloring-book-cover` (post-fit), `coloring-book-render` interior page output, `coloring-book-assemble` (PDF page + every image drawn). Any mismatch = hard error, book stays queued with `blocker_reason: trim_mismatch`.
- Test `src/lib/coloringTrimLock.test.ts`.

## Rule 3 — Dedicated fitted thumbnail (new asset, distinct URL)

Chosen thumbnail canvas: **600×776 px** (same 8.5:11 ratio, matches 2× the largest storefront card width `w-64`=256px + retina headroom, minimum for crisp product-page hero on mobile). Format: JPEG q=85 for smaller file (thumbnails, not print).

New edge function `coloring-book-thumbnail`:
- Input: `ebook_kids_id`.
- Downloads the approved master `cover_url` from storage.
- Renders on 600×776 canvas: white background, `object-contain` fit (letterbox if aspect drifts), 12px inner safe-margin. NO text overlay added — this is a pure re-derive from the already-baked cover art.
- Runs a non-crop check: sample the 4 edges of the fitted image and confirm no non-white pixels within 4px of the letterbox edges (means nothing is bleeding/clipped).
- Uploads to `ebook-covers` bucket at `kids/thumbnails/{id}-{hash}.jpg`.
- Updates `ebooks_kids.thumbnail_url` (must be distinct from `cover_url`) and `store_thumbnail_url`.

Wire it into:
- `coloring-book-cover` end-of-run (after cover accepted).
- `kids-publish-if-qc-passed` as a pre-publish requirement.
- A one-shot backfill invocation for every currently-live coloring book.

## Release gate wiring (`gates.ts` / `kids-publish-if-qc-passed`)
Add three pre-publish assertions:
1. `cover_baked_title_only`: cover row's `typographySource === "ideogram_integrated"` AND no `overlay_applied`.
2. `trim_verified`: cover master matches `COLORING_TRIM.coverPx*`, PDF page = 612×792pt.
3. `thumbnail_distinct_and_fitted`: `thumbnail_url IS NOT NULL AND thumbnail_url != cover_url AND thumbnail_render_meta.non_crop_pass = true`.
Any fail → block publish, set `blocker_reason` accordingly.

## Persistence in `pipeline_skills`
Upsert row `coloring-cover-thumbnail-contract-v1` with all three rules as machine-readable JSON so runtime gates read from DB, not just code constants.

## Backfill pass (execute at end)
Query `ebooks_kids WHERE book_type='coloring_book' AND listing_status='live'` at execution time. For each:
1. Read cover proof metadata → if `typographySource !== "ideogram_integrated"` → flag for regeneration (do NOT auto-redraw in this pass; log to `blocker_reason='cover_style_violation_flagged'` and demote to draft).
2. Assert trim on stored cover asset → if mismatch, re-fit to 1600×2071.
3. Invoke `coloring-book-thumbnail` to generate the distinct thumbnail.
4. Re-embed the (unchanged) cover in the PDF only if trim was corrected.

## Docs
- Append rules to `mem://design/kids-cover-prompt.md`.
- Update `.agents/skills/secretpdf-production-suite/references/known-regressions.md` and `.claude/skills/.../known-regressions.md` with "coloring-cover: baked-title-only, overlay-forbidden" and "coloring-thumbnail: must be distinct asset".
- Update `mem://index.md` if a new core rule emerges.

## Files changed (expected)
- edit `supabase/functions/coloring-book-cover/index.ts` (remove overlay branches)
- edit `supabase/functions/_shared/coloring/coloring-cover-proof.ts` (add double-text assertion)
- edit `supabase/functions/_shared/coloring/coloring-cover-compositor.ts` (adult-only guard)
- edit `supabase/functions/_shared/coloring/gates.ts` (new hard fails + pre-publish assertions)
- edit `supabase/functions/coloring-book-assemble/index.ts` (trim assertion)
- edit `supabase/functions/coloring-book-render/index.ts` (trim assertion)
- edit `supabase/functions/kids-publish-if-qc-passed/index.ts` (wire gates)
- new `supabase/functions/_shared/coloring/trim-lock.ts`
- new `supabase/functions/coloring-book-thumbnail/index.ts`
- new tests: `coloringCoverBakedTitleOnly.test.ts`, `coloringTrimLock.test.ts`, `coloringThumbnailDistinct.test.ts`
- new migration: seed `pipeline_skills` contract + `thumbnail_render_meta` JSONB column on `ebooks_kids` if not present
- docs: `mem://design/kids-cover-prompt.md`, `known-regressions.md`

## Report at end
- Live count at execution time
- How many needed cover-style flag (rule 1) vs already correct
- Confirmed trim dimensions
- Chosen thumbnail canvas (600×776) with reason
- Confirmation every live book now has a distinct `thumbnail_url`
