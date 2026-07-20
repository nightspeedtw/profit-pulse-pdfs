## Problem

The yellow circular "AGES 13-17 / AGES 6-8" pill still overlays the bottom-left of every V2 cover (see image-60), clipping the subtitle banner and covering artwork. Owner wants AGES integrated into the design itself — no floating popup pill.

## Fix (permanent)

**1. `supabase/functions/_shared/coloring/premium-cover-overlay.ts`**
- Delete all pill geometry (pillR / pillCX / pillCY / pillFontSize) and any remaining pill SVG.
- Bake the age label INTO the top "COLORING BOOK" chip as a single unified pill:
  - New chip text format: `COLORING BOOK · AGES 6-8`
  - Keep the dark navy chip with yellow border + yellow text (already on-brand).
  - Auto-widen chip based on combined text length; keep it centered at the top.
- Age is no longer drawn anywhere else on the cover. `ageBadge` input is still accepted (for the chip), but no separate pill element is ever rendered.
- Keep top-right SALE ribbon and bottom subtitle/blurb banner unchanged.

**2. `coloring-v2-cover/index.ts`**
- No API change: it already passes `ageBadge: "AGES 6-8"` and `topLabel: "COLORING BOOK"`. Overlay now merges them internally.
- Bump `overlay` meta tag to `premium_cover_overlay_v3_age_in_chip` for provenance.

**3. Regression test**
- Extend `src/__tests__/cover-text-overlay-only-v2.test.ts` (or add a small unit test) that asserts the rendered SVG string contains the merged "COLORING BOOK · AGES" text and contains no `pillGrad` / age-pill circle element.

**4. Republish existing live books**
- Reset stage → `cover` and refire `coloring-v2-cover` for the 6 live V2 books (Busy Block ABCs, Mucky Boots, Mythic Marvels, Cyber City Countdown, Soulful Symmetry, Mighty Dino) so the new chip-with-age design ships to storefront. Bridge is already idempotent (upsert on `coloring_v2_book_id`), so no duplicate storefront rows.

## Out of scope
- No changes to Ideogram prompts, OCR gate, PDF matter pages, or storefront UI.
- No layout changes to SALE ribbon or bottom banner beyond removing the pill.
