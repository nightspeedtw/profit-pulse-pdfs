
# Permanent Fix — Coloring-Book Cover Master Prompt

Scope: `book_type='coloring_book'` ONLY. Picture-book / adult lanes untouched (scope guard `assertColoringOnly`).

## 1. Canonical prompt module

Replace the ad-hoc clauses in `_shared/coloring/ideogram-integrated-cover.ts::buildIdeogramIntegratedCoverPrompt` with a new dedicated module:

`supabase/functions/_shared/coloring/master-cover-prompt.ts`

Exports:
- `COLORING_MASTER_COVER_PROMPT_VERSION = "coloring_master_cover_v1"`
- `buildMasterColoringCoverPrompt(input)` — returns the English "short-form" master prompt (the automation variant the user provided), filling in these fields from the ebook row + page plan:
  - `[BOOK TITLE]` — `ebooks.title`
  - `[SUBTITLE]` — `ebooks.subtitle` (fallback `"A Fun Coloring Adventure"`)
  - `[AGES]` — `"Ages {min}-{max}"`
  - `[THEME]` — category / theme phrase
  - `[MAIN CHARACTERS]` — resolved hero list (1-3)
  - `[BACKGROUND ELEMENTS]` — from `defaultBackgroundHintFor(category)` + palette
- Structural guards (throw on violation, mirrors `assertColoringCoverPromptIsTextless` pattern):
  - Title/subtitle/age strings present verbatim
  - No banned words: `watermark, logo, page number, website`
  - Prompt length ≤ 3000 chars (Runware cap)
  - Reference-image usage clause always present (interior refs are guidance-only, never copy)
- `assertMasterPromptShape(prompt, {title, subtitle, ageBadge})` — called before dispatch.

Canonical composition (square-first per owner law):
- 1:1 canvas, 8.5 × 8.5 in
- Title occupies upper 30-40%, custom hand-drawn lettering
- Hero 1-3 characters centered/lower half
- Age badge in a corner
- 0.25 in safe area
- Bright pastel palette
- Style: "premium children's coloring book cover, hand-lettered, print-ready"
- Explicit: reference images are inspiration ONLY, redraw everything, do not reuse an interior page as the cover.

## 2. Wire it into the cover pipeline

- `supabase/functions/coloring-book-cover/index.ts`: swap `buildIdeogramIntegratedCoverPrompt` → `buildMasterColoringCoverPrompt` for the coloring lane. Keep the same Runware Ideogram v3 dispatch, verifier (`verifyExactCoverText`), and spelling gate (non-waivable).
- Trim resolution: force **square** (`square_8_5`) dims for the coloring lane — request `1088×1088` (or nearest Runware-supported square, e.g. 1024×1024) instead of the 8.5:11 portrait numbers. Add `runwareSquare = 1088` to `dims`.
- Overlay compositor (`coloring-cover-compositor.ts`): keep the shrink-to-fit title treatment as a fallback safety net when the baked title fails the verifier (already implemented).
- Thumbnail (`coloring-book-thumbnail` step / renderThumbnail): re-render 600×776 → **change to 600×600 square** to match new trim.

## 3. Fix the LATEST book first (single-book validation)

Book: `Superhero Unicorn Fantasy Coloring Book` (`d6da92a8`). Latest live book; cover currently self-art fallback.

Sequence (owner's order):
1. Deploy new master-prompt module + wire-in.
2. Reset that one book's cover state: clear `cover_url`, `cover_bg_url`, `thumb_url`; reset `coloring_cover_invocations = 0`, `coloring_cover_ideogram_attempts = []`; keep interior pages intact.
3. Invoke `coloring-book-cover` once for `d6da92a8` — generates cover via new master prompt using 3 interior pages as refs.
4. Invoke `coloring-book-thumbnail` — regenerates square thumbnail.
5. Owner reviews cover + thumbnail against the uploaded reference.
6. **Only if approved**: invoke `coloring-book-assemble` + `coloring-book-publish` to rebuild the PDF with new cover.

## 4. Regression tests

New: `src/lib/coloringMasterCoverPrompt.test.ts`
- Master prompt contains title/subtitle/age verbatim
- Master prompt contains reference-image "inspiration only, do not copy" clause
- Assertion throws when title missing
- Assertion throws when banned word present
- Square dims returned for `square_8_5` books

## 5. Non-goals

- No changes to picture-book covers.
- No new provider.
- Do NOT lower any QC gate.
- Do NOT touch story/manuscript lanes.

## Technical details

Files to add / edit:
- ADD `supabase/functions/_shared/coloring/master-cover-prompt.ts`
- EDIT `supabase/functions/coloring-book-cover/index.ts` (~line 22 import, ~line 420 prompt build, dims resolver)
- EDIT `supabase/functions/_shared/coloring/ideogram-integrated-cover.ts` (add square dim support + accept externally-built prompt via optional `promptOverride`)
- EDIT thumbnail renderer for square output
- ADD `src/lib/coloringMasterCoverPrompt.test.ts`

Rollout: deploy → run for `d6da92a8` (cover+thumb only) → owner approval → PDF assemble.
