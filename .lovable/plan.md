
# Two owner laws to codify

## Problem 1 — Covers still look the same

Style rotation is wired in `supabase/functions/coloring-v2-cover/index.ts` (calls `pickCoverArtStyle`, tags `meta.cover_art_style`), but the shelf is not diverse. Evidence from `coloring_v2_assets` where `kind='cover_final'`:

- Last 14 days: 156 cover finals, only 2 tagged with a rotation style (`kawaii_sticker_pastel`, `soft_gouache_storybook`).
- Alternate cover writers bypass the rotation entirely:
  - `coloring-v2-illustrated-cover-once` uses its own hard-coded `COVER_ART_MOODS` pool (6 moods, deterministic by book_id) and its own lettering pool — no `pickCoverArtStyle` call.
  - Recovery/repair paths and older laws (`cover_source_of_truth_v11`, `cover_reference_quality_v16`, `cover_bake_only_v6_hard_reject`) also skip the rotation.
- Recency window in `pickCoverArtStyle` = last 4 books only, so the same 2–3 styles cluster back-to-back on the shelf.

## Problem 2 — Alphabet / numbers books ship without full coverage

Concept + page-plan generators can emit "Alphabet …" or "Counting …" themes on 16-page or partial 32-page plans. A-Z needs 26 letter pages; 0–9 needs 10 number pages. Neither is enforced anywhere:

- No gate in `_shared/coloring-v2/prompts.ts` (concept), `coloring-v2-page-plan`, or seasonal seed data prevents an alphabet book with fewer than 26 letter pages.
- Existing catalog has "Alphabet Appetites" style titles at 32-page format that do not walk A→Z, plus 16-page number books with gaps.

# Plan

## A. Cover-diversity law `cover_style_rotation_v2`

1. **Single source of truth for cover art direction.**
   - Extract the whole style pool into `_shared/coloring/cover-art-styles.ts` (already exists) and add a `hardMinRecencyWindow` = 8 books.
   - Give every style equal base weight (`weight: 1`) so no look dominates; keep `themeAffinity` only as a soft +1 bonus.
   - Add a **hard "no repeat within last 6 covers"** filter in `pickCoverArtStyle` (currently soft avoidance of last 4).

2. **Kill the parallel style pools.**
   - Delete `COVER_ART_MOODS` + local lettering pool from `coloring-v2-illustrated-cover-once/index.ts`. Route it through `pickCoverArtStyle` and `buildIllustratedPrompt` (or `buildMasterColoringCoverPromptWithRotation`) so every cover writer picks from the same catalog.
   - Same treatment for any lingering hard-coded style clauses in `coloring-v2-repair-book` cover regen path.

3. **Always persist rotation metadata.**
   - Every `uploadAsset(..., 'cover_final', ...)` must include `cover_art_style`, `cover_art_style_label`, `cover_art_style_pick_reason` in `meta`. Add a shared helper `buildCoverFinalMeta()` and use it in all three writers.
   - Add a runtime guard in `state.ts` `uploadAsset`: if `kind === 'cover_final'` and `meta.cover_art_style` is missing, throw — makes the contract permanent.

4. **Regression tests** (`src/__tests__/`):
   - `coloring-cover-style-rotation.test.ts` (exists) — extend: 20 sequential picks over 10 styles must cover ≥ 8 distinct styles; no style repeats within a 6-book window.
   - New test: cover-final meta contract — asserts every writer includes `cover_art_style`.

5. **Diversity backfill.**
   - One-off regen sweep: for the ~150 live coloring books whose `cover_final.meta.cover_art_style` is NULL, enqueue a cover-regen job through `coloring-v2-cover` with a forced rotation pick. Rate-limited to the existing One-Book-At-A-Time lease so it doesn't fight active production.

## B. Alphabet / Numbers coverage law `coloring_full_coverage_v1`

1. **Concept-stage ban.**
   - In `_shared/coloring-v2/prompts.ts` concept system prompt, add: "If the theme implies alphabet, ABC, letters, phonics, spelling — the book MUST include all 26 letters A–Z, one letter per page. If the theme implies counting, numbers, 123, digits — the book MUST cover 0–9 (10 pages) or 1–20 (20 pages), one number per page. If the requested `page_count` cannot fit full coverage, choose a different theme."
   - Concept validator rejects (`concept_full_coverage_violation`) any concept where `theme` matches `/alphabet|abc|letters|phonics|spelling/i` and `page_count < 26`, or `/counting|numbers?|123|digits/i` and page_count `< 10`.

2. **Page-plan enforcement.**
   - In `coloring-v2-page-plan`, when the concept is flagged alphabet/counting, generate a deterministic slotted plan:
     - Alphabet: page 1 = "A is for …", page 2 = "B is for …", … page 26 = "Z is for …". Remaining pages (if 32-page format = 6 spare) are theme-appropriate bonus scenes.
     - Counting: page 1 = "1 …", … page 10 = "10 …" (or 0–9 depending on age band). Extras same treatment.
   - Add validator `validatePagePlan` rule that rejects a plan tagged `alphabet` missing any letter or with duplicates, same for `counting`.

3. **Concept anti-anchor update.**
   - In `kids-concept-preflight` anti-anchoring list, keep "Alphabet" but require the concept to attach `coverage_contract: { kind: 'alphabet', letters: ['A'…'Z'] }`. Anti-anchor still avoids overusing the theme.

4. **Retire bad legacy books.**
   - SQL sweep: any `coloring_v2_books` with title matching `/alphabet|abc|counting|numbers?/i` where the interior page plan doesn't satisfy the new contract → set `publish_status='retired'` and `sellable=false`. Do not delete assets (P0 evidence).

5. **Regression tests** (`src/__tests__/`):
   - `coloring-full-coverage-alphabet.test.ts` — 16-page alphabet concept rejected; 32-page accepted only when plan has all 26 letters distinct.
   - `coloring-full-coverage-numbers.test.ts` — mirror for counting themes.

## C. Deploy + verify

- Redeploy `coloring-v2-cover`, `coloring-v2-illustrated-cover-once`, `coloring-v2-page-plan`, `coloring-v2-concept`.
- Run unit tests.
- Trigger backfill cover-regen queue.
- Confirm on next tick: (a) new covers show distinct styles across a 6-book window, (b) any queued alphabet/counting book without full coverage is rejected at concept stage.

# Technical notes

- Files touched:
  - `supabase/functions/coloring-v2-cover/index.ts`
  - `supabase/functions/coloring-v2-illustrated-cover-once/index.ts`
  - `supabase/functions/coloring-v2-repair-book/index.ts`
  - `supabase/functions/coloring-v2-concept/index.ts`, `coloring-v2-page-plan/index.ts`
  - `supabase/functions/_shared/coloring/cover-art-styles.ts`
  - `supabase/functions/_shared/coloring/master-cover-prompt.ts`
  - `supabase/functions/_shared/coloring-v2/state.ts` (uploadAsset guard)
  - `supabase/functions/_shared/coloring-v2/prompts.ts`
  - New `src/__tests__/coloring-cover-style-rotation.test.ts` extension + coverage tests.
- No storefront/UI changes.
- No threshold reductions or gate bypasses. Fixes the class, not the row.

Confirm and I'll implement in one pass.
