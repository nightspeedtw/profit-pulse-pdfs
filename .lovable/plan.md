## Why the rotation looks "missing"

Last turn I wired `pickCoverArtStyle` into **only** `supabase/functions/coloring-v2-cover/index.ts` (its local `buildIllustratedPrompt`).

But the canonical prompt everyone calls "the master prompt" lives in `supabase/functions/_shared/coloring/master-cover-prompt.ts` (`buildMasterColoringCoverPrompt`, version `coloring_master_cover_v6_bake_only`). That file is imported by:

- `supabase/functions/coloring-book-cover/index.ts` (V1 coloring cover lane — still used by repair sweeps and older books)
- `supabase/functions/kids-repair-cover/index.ts` (has its own hard-coded prompt too)

In the master prompt, art direction is hard-coded in three fragments — `openingClause`, `paletteClause`, `styleTag` — with only a single `styleMode: "default" | "ya_scifi_cinematic"` switch. No rotation, no bubble-letters, no cut-paper, no crayon. That's why every cover it renders keeps landing on the same "rich saturated painterly" look.

Recent `coloring_v2_assets.meta` also shows zero `cover_art_style` values, because those rows were generated before the V2 change deployed.

## What the plan changes

Make style rotation a property of the **Master Prompt itself**, so every lane (V1, V2, repair) inherits it automatically.

### 1. Extend the master prompt to accept a chosen style

`supabase/functions/_shared/coloring/master-cover-prompt.ts`:

- Import `CoverArtStyle` from `_shared/coloring/cover-art-styles.ts`.
- Add optional `artStyle?: CoverArtStyle` to `MasterColoringCoverInput`.
- When `artStyle` is present, replace `openingClause` / `paletteClause` / `styleTag` with fragments derived from `artStyle.prompt_fragment`, and replace the generic hand-lettering sentence inside `layoutClause` with `artStyle.title_lettering_fragment`.
- Keep `styleMode: "ya_scifi_cinematic"` as an override that still forces the cinematic branch (teen books).
- Bump version constant to `coloring_master_cover_v7_style_rotation` and update `assertMasterPromptShape` to still enforce the title + age-badge verbatim contracts.

### 2. Have the master prompt pick a style when the caller didn't

Add a small helper `buildMasterColoringCoverPromptWithRotation(db, input)`:

- Calls `pickCoverArtStyle(db, input.title)`.
- Passes the returned `style` into `buildMasterColoringCoverPrompt`.
- Returns `{ prompt, style, pickReason }` so callers can persist `cover_art_style` into asset meta.

Pure `buildMasterColoringCoverPrompt` stays deterministic (no DB) for tests.

### 3. Wire every remaining cover lane through it

- `supabase/functions/coloring-book-cover/index.ts` (around the current `buildMasterColoringCoverPrompt` call at line ~663): switch to `buildMasterColoringCoverPromptWithRotation` and write `cover_art_style` / `cover_art_style_label` / `cover_art_style_pick_reason` into the uploaded asset's meta.
- `supabase/functions/kids-repair-cover/index.ts`: replace the inline `masterPrompt` array with the master-prompt call so repairs also rotate.
- `supabase/functions/coloring-v2-cover/index.ts`: switch its local `buildIllustratedPrompt` to call `buildMasterColoringCoverPrompt({ ..., artStyle })` so V2 and V1 use one prompt source of truth (no more drift).

### 4. Regression tests

Extend `src/__tests__/coloring-cover-style-rotation.test.ts` and add master-prompt-specific assertions:

- `buildMasterColoringCoverPrompt` with `artStyle=bouncy_bubble_letters` must include the bubble-letter fragment and must NOT contain the old "rich saturated painterly illustration" default sentence.
- `buildMasterColoringCoverPrompt` with `artStyle=cut_paper_collage` must include the cut-paper fragment.
- `assertMasterPromptShape` still passes (verbatim title + ageBadge intact, length ≤ 3200, banned words only inside negative clauses).
- `coloring-book-cover/index.ts` and `kids-repair-cover/index.ts` sources must reference `buildMasterColoringCoverPromptWithRotation` (locks the wiring so it can't regress to a hardcoded prompt again).

### 5. No changes to

- QC gates, OCR contract, `cover_illustrated_only_v12` law strings, storefront upload, or PDF assembly.
- Picture-book (non-coloring) covers — they run on a different path.

## Technical details

- Version bump: `coloring_master_cover_v6_bake_only` → `coloring_master_cover_v7_style_rotation`. Old v6 string stays referenced only inside the version constant name for `alert_log` continuity.
- Recency window stays at 4 (as implemented in `pickCoverArtStyle`). No new DB migration needed — `cover_art_style` continues to live inside `coloring_v2_assets.meta` and the equivalent V1 asset meta.
- No threshold, gate, or law is lowered.

## Definition of done

1. `bunx vitest run src/__tests__/coloring-cover-style-rotation.test.ts src/__tests__/cover-bake-only-v6.test.ts src/__tests__/coloring-cover-illustrated-only-v12.test.ts` all green.
2. Three fresh cover generations (any lane) show three different `cover_art_style` values in `coloring_v2_assets.meta`.
3. No hardcoded "rich saturated painterly illustration" sentence remains in the master prompt output when an `artStyle` is provided.
