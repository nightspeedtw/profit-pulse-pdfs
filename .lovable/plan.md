# Owner Review — 3 Defect Classes → Permanent Fixes + Ocean Friends Rebuild

## Scope
Fix at the **class** level (skills + regression tests), then rebuild Ocean Friends through the fixed path and hold from publish for external re-verification.

## Defect Class 1 — Cover double-text / wrong subject / clipped badge

Root cause: `runSingleCoverRung` only forbids text in the prompt string; it does not **verify** the generated art contains no glyphs, and does not verify the hero matches the category's `allowed_subjects`. Result: baked-in "Ocean Friends Coloring Adventure" + gibberish "Cover Slook" + SVG title = triple text. Ages badge SVG is anchored at `translate(W-340, H-150)` with a 280×90 pill — on a 1600×1600 canvas the pill lands OK, but on the *composited* cover (which is scaled to portrait 4:3 in some rungs) it clips off-canvas.

Fix (permanent, all cover paths — kids storybook + coloring share `kids-cover-ladder.ts`):

1. New module `supabase/functions/_shared/covers/cover-vision-guards.ts`:
   - `transcribeGlyphs(bytes)` → uses Gemini vision (`gemini-2.5-flash` via existing `gemini-direct`) to return `{ detected_text: string, has_glyphs: boolean, confidence }`. Cost-bounded (single call/rung).
   - `verifyCategoryHero(bytes, { allowed_subjects, forbidden_subjects, category_name })` → Gemini vision returns `{ matches: boolean, detected_subjects: string[], reason }`.
2. Extend `SingleRungResult` with `dead-equivalent` outcomes for `baked_text` and `wrong_subject`. These are silent advances (do NOT consume retire budget), same as luminance-dead.
3. Wire both guards into `runSingleCoverRung` **after** the luminance check, before returning `ok`. Skip guards for `svg_synthetic_fallback` (no AI art) — SVG rung remains dead-impossible terminal.
4. `coloring-book-cover/index.ts`: pass `allowedSubjects`/`forbiddenSubjects` (from `coloring_categories.allowed_subjects` / `forbidden_subjects`) into the ladder input. Persist per-rung `vision_reports` into `metadata.coloring_cover_ladder.reports`.
5. Ages-badge clip fix: reposition to safe-zone anchor computed from `viewBox` (`x = W - 340 - safe`, `y = H - 150 - safe`, where `safe = max(48, W * 0.04)`), clamp to visible bounds, shrink pill width proportionally if title-treatment canvas is < 1600 wide.
6. Confirm: `coloring-book-cover` calls **only** `runSingleCoverRung` from `kids-cover-ladder.ts` (already true — no independent cover code path exists to delete). Add an AGENTS.md line under `supabase/functions/` forbidding future independent cover code.

**Regression tests** (`src/lib/kidsCoverLadder.test.ts`):
- Mock rung returning bytes flagged as `has_glyphs=true` → status becomes `dead-equivalent`, ladder advances to next rung, does not return ok.
- Mock rung with hero classified as `wrong_subject` → advances.
- Composite over textless bytes → final composite metadata reports title exactly once (regex count in returned SVG source string).
- Ages badge fits inside viewBox for both 1600 and 1200 canvas widths.

## Defect Class 2 — Interior page sharpness inconsistency

Measured range 2.6–20.3 edge-density; crisp pages ≥9, blurry ≤6.

Fixes:

1. New `supabase/functions/_shared/coloring/sharpness-gate.ts`:
   - `computeSharpness(bytes)` → downsamples to 512px, converts to luminance, computes Laplacian variance + edge-density (Sobel magnitude ratio). Returns `{ laplacian_var, edge_density, score }`.
   - `DEFAULT_SHARPNESS_MIN_SCORE = 8.0` (calibrated from owner-cited crisp pages ≥9; floor at 8.0 leaves 1.0 headroom for JPEG variance). Configurable via `metadata.coloring_style_contract.sharpness_min_score` if the owner later tightens.
2. Wire into `coloring-book-render/index.ts` after `analyzeSolidBlack` and before upload: fail → increment repair counter, add reason `sharpness_gate: score=X < 8.0`, do not upload. Existing repair-ladder decides regen/simplify.
3. **Uniform generation params enforcement**: all interior calls already use `falFluxSchnell({ image_size: "portrait_4_3" })`. Add:
   - `metadata.coloring_generation_params` written on first page as `{ model, image_size, step_prefix }`.
   - Subsequent pages assert equality; mismatch → refuse render with `param_uniformity_violation` blocker (never lower gate; forces code fix).
   - Log the resolved params in each `StoredPage.render_params`.
4. Matter pages (title/copyright/tips/certificate) are exempt — they're not FAL-rendered, they're pdf-lib.

**Regression tests** (`src/lib/coloringSharpness.test.ts`):
- Synthetic sharp fixture (checkerboard) → score ≥ 8, pass.
- Synthetic blurred fixture (Gaussian) → score < 8, fail.
- Threshold constant is exported and imported by test to prevent silent drift.

## Defect Class 3 — Text overflow on matter/certificate/footer

Root cause: `coloring-book-assemble/index.ts` uses raw `pdf-lib` `page.drawText` with fixed font sizes; no measure-shrink-wrap. SKILL A (shrink-to-fit) exists for storybook but was not extended to coloring lane.

Fixes:

1. New `supabase/functions/_shared/pdf/shrink-to-fit.ts`:
   - `drawFitText(page, { text, x, y, maxWidth, maxHeight, font, size, minSize, color, align })` — measure at requested size, shrink in 0.5pt steps to `minSize` (default 8pt), then wrap; asserts final layout ≤ bounds or throws `text_overflow` (which retries with `minSize` further reduced, terminal at 6pt with truncation ellipsis + logged reason — never clips).
   - `drawFitParagraph(...)` for multi-line paragraph blocks (copyright, tips).
2. Refactor `coloring-book-assemble` matter pages, certificate, and `drawColoringFooter` copyright text to use these helpers. Footer logo size unaffected.
3. Ownership/copyright long-string safety: pass full `© YYYY secretpdf.co. All rights reserved. …` string through `drawFitParagraph` with `maxWidth = PAGE_W - 2*SAFE_MARGIN - 80`, `maxHeight = 240`.

**Regression tests** (`src/lib/coloringPdfShrinkFit.test.ts`):
- Long ownership string (600 chars) → shrinks to ≤8pt and wraps, never overflows `maxWidth`.
- Short string → renders at requested size unchanged.
- Extreme string (10,000 chars) → truncates with ellipsis, never throws, never clips.

## Skill ledger

Insert 3 rows into `public.pipeline_skills` (scope=coloring, status=learned):
- `no_baked_text_on_cover_art` — textless AI + vision transcription gate + SVG-only typography.
- `interior_sharpness_gate` — Laplacian ≥ 8.0 or regenerate; uniform generation params enforced.
- `layout_text_shrink_to_fit` — every layout string uses `drawFitText`/`drawFitParagraph`.

## Rebuild Ocean Friends (a05a5086)

Post-deploy sequence, hold from publish:
1. Clear existing cover: unset `cover_url`, reset `metadata.coloring_cover_ladder` and `metadata.coloring_cover`.
2. Dispatch `coloring-book-cover` → runs full ladder through new vision guards.
3. Compute sharpness on every stored interior page; regenerate any page with score < 8.0. Report list of regenerated page numbers.
4. Re-run `coloring-book-assemble` (matter pages re-rendered via shrink-to-fit).
5. Weighted acceptance runs as today. `coloring-book-publish` is not chained — leave `awaiting=owner_final_verification` for external PDF review before flipping live.

## Deliverables

- Files added: `_shared/covers/cover-vision-guards.ts`, `_shared/coloring/sharpness-gate.ts`, `_shared/pdf/shrink-to-fit.ts`, three test files above.
- Files edited: `_shared/covers/kids-cover-ladder.ts`, `_shared/covers/kids-title-treatment.ts`, `coloring-book-cover/index.ts`, `coloring-book-render/index.ts`, `coloring-book-assemble/index.ts`, `supabase/functions/AGENTS.md`.
- DB: skill-ledger inserts.
- Report to owner: sharpness threshold chosen (**8.0**), pages regenerated (computed live), rung reports for the new cover (glyph + subject verdicts per rung), and the fresh signed PDF URL for external verification. Publish is **held**.

## Risks / assumptions

- Gemini vision guards add ~1 extra call per non-fallback rung (~$0.001 each) — cost bounded.
- Sharpness threshold 8.0 is calibrated from the owner's cited scores (crisp ≥9, blurry ≤6). If Ocean Friends regen storm exceeds 6 pages, threshold gets a targeted per-book relax with owner sign-off, never a silent lowering.
- SVG fallback rung remains guaranteed terminal — no ladder path can retire the book.
