## Problem

"Bubbly Ocean Buddies" cover reverted to font-overlay typography again. Timeline of `coloring_v2_assets` for book `6133ac75`:

- 08:44 — hand-lettered illustrated cover (`law=cover_illustrated_hand_lettered_once_v1`) ✅
- 08:54, 08:56, 09:03, 11:36, 12:01 — five new `cover_final` assets with `typography_source=deterministic_exact_title_render` (font overlay) ❌

Root cause: the short-circuit in `coloring-v2-cover/index.ts` (line 177–185) only checks the currently `approved_cover_asset_id`. When repair sweeps / stage resets pointed approved_cover_asset_id at a different (older) asset, the illustrated cover was no longer "current", so the cover stage ran normally and overwrote it with a deterministic-typography build. Each repair PDF cycle re-approved a font-overlay asset.

## Owner law (permanent)

**`cover_illustrated_only_v12`** — for coloring books, the cover MUST be a hand-drawn illustration with the title hand-lettered INTO the artwork. Deterministic SVG/font typography is FORBIDDEN on coloring covers.

## Fix

### 1. Permanently ban the font-overlay path for coloring covers
In `supabase/functions/coloring-v2-cover/index.ts`:
- Replace the "generate deterministic typography cover" body with a call to the illustrated-cover generator (same logic as `coloring-v2-illustrated-cover-once`), so every regeneration produces a hand-lettered painted cover.
- Remove the `deterministic_exact_title_render` code path and the `typography-source-verifier` gate entirely for the coloring lane.
- Keep style-family + layout picking only as prompt hints for the illustration prompt (no SVG compositing).

### 2. Sticky illustrated-cover short-circuit (defense in depth)
Broaden the short-circuit so it fires whenever ANY existing `cover_final` asset for the book has `law IN ('cover_illustrated_hand_lettered_once_v1','cover_illustrated_only_v12')`, regardless of what `approved_cover_asset_id` currently points to. If found, re-approve it (fix pointer) and advance to QC — never re-run the cover model.

### 3. Repair "Bubbly Ocean Buddies" now
- Call `coloring-v2-illustrated-cover-once` for book `6133ac75` / ebook `b0935a5f` to produce a fresh hand-lettered cover.
- Point `approved_cover_asset_id` at the new asset.
- Rebuild the PDF (`coloring-v2-pdf`) so the interior PDF's cover page matches the storefront cover.
- Update `ebooks_kids.cover_url` + `thumbnail_url` to the new signed URL.

### 4. Regression test
Add `src/__tests__/coloring-cover-illustrated-only-v12.test.ts` asserting:
- `coloring-v2-cover` module does not import `typography-source-verifier` or `premium-cover-overlay` (SVG-typography modules).
- The short-circuit key list contains both `cover_illustrated_hand_lettered_once_v1` and `cover_illustrated_only_v12`.
- Any `cover_final` asset produced by the coloring lane has `meta.text_mode === 'illustrated_hand_lettered_baked'`.

### 5. Codify the law
Write `.lovable/coloring-cover-illustrated-only-law.md` and register a `pipeline_skills` row `cover_illustrated_only_v12` so future agents don't reintroduce the font-overlay ladder.

## Files to change

- `supabase/functions/coloring-v2-cover/index.ts` — rewrite: illustrated-only, sticky short-circuit
- `supabase/functions/_shared/coloring-v2/illustrated-cover.ts` — new shared helper extracted from `coloring-v2-illustrated-cover-once`
- `supabase/functions/coloring-v2-illustrated-cover-once/index.ts` — refactor to call the shared helper
- `src/__tests__/coloring-cover-illustrated-only-v12.test.ts` — new regression test
- `.lovable/coloring-cover-illustrated-only-law.md` — new law doc

## Deferred (unless you say otherwise)
- Retroactively re-generating illustrated covers for the other legacy books that shipped with deterministic typography. Say the word and I'll batch them after Bubbly Ocean Buddies is verified live.