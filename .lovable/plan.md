## Goal
Stop the Title / Copyright / How-to / Certificate matter pages from stacking the SecretPDF logo, the © line, the decorative border, and the corner vignette on top of each other. All four elements must live in reserved zones that never intersect.

## Root cause (verified in `supabase/functions/_shared/coloring/matter-pages.ts`)
- `drawDecorativeBorder` draws the outer ring at `inset = 24` and the inner double-rule at `inset + 8 = 32`, and drops confetti dots at all four corners at `inset + 18`.
- `drawCornerVignettes` places one vignette at **bottom-right** (`margin = 44`), the same corner as the logo.
- `drawBrandFooter` writes the © line at `x = 30, y = 22` and the logo at `y = 22 - 4 = 18` with `height ≤ 22pt`, so both cross the outer border ring at y≈24 and overlap the bottom confetti dots.

## Fix (layout-only, no business logic change)
1. **Reserve a footer band inside the border.** Introduce `FOOTER_BAND_H = 34pt`. Lift `drawBrandFooter` so the baseline sits at `y = inset2 + 6` (~38pt from bottom) instead of 22pt, keeping the entire footer strictly inside the inner double-rule.
2. **Cap the logo cleanly.** Reduce `maxLogoH` to 18pt and `maxLogoW` to `pageW * 0.22`, and enforce a ≥ 24pt horizontal gap between the © line's right edge and the logo's left edge (shrink `©`'s `maxWidth` to `pageW - marginX*2 - logoW - 24`, wrap font down if needed via existing `drawFitText` minSize).
3. **Keep the border clear of the footer.** `drawDecorativeBorder` gains an optional `reserveFooter: boolean`. When true, the bottom **confetti dots are omitted** (top corners still get them), so nothing collides with © / logo.
4. **Move the corner vignette off the footer corner.** `drawCornerVignettes` gains `avoidBottom?: boolean`. When true, the two vignette slots become **top-left + top-right** instead of top-left + bottom-right, so the airship/ship no longer sits behind the logo.
5. **Wire the three flags together in the matter renderers.** `drawColoringTitlePage`, `drawColoringCopyrightPage`, `drawColoringHowToPage`, and `drawColoringCertificatePage` call the border with `reserveFooter: true`, call vignettes with `avoidBottom: true`, and call `drawBrandFooter` last so it paints on top of the reserved band.
6. **Nudge the "This book belongs to" / body content up** on the title page by the same `FOOTER_BAND_H` delta so the nameplate does not push into the new footer band (adjust the `titleY` / nameplate `y` offsets only — copy stays identical).

## Non-goals
- No change to cover generation, the hand-lettered cover law, the anatomy verifier, or any pipeline stages.
- No change to fonts, palette tokens, copy text, or the `matter_pages_brand_footer_v1` policy — only geometry.
- No frontend / storefront changes.

## Verification
- Add a unit test `supabase/functions/_shared/coloring/matter-pages.layout.test.ts` (or extend the existing matter-pages test) asserting:
  - footer y ≥ inner-rule y + safe gap,
  - logo rect and © rect do not overlap,
  - no confetti dot center falls inside the footer band,
  - vignette rects never intersect the footer band when `avoidBottom` is true.
- Rebuild the PDF for **Gears and Galleons Coloring Book** (the book in the screenshot) via `coloring-v2-pdf` and re-publish, then re-open page 1 to confirm the circled areas are clean.

## Technical notes
- All edits are confined to `supabase/functions/_shared/coloring/matter-pages.ts` plus the one test file. No schema change, no new env var, no new AI call.
- Constants land in a small `LAYOUT` object at the top of the file so future matter pages inherit the same reservations.
