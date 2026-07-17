## Goal
1. Give the Coloring Autopilot admin card the same age options shown on the storefront chips: **2–4, 4–6, 6–8, 8–12, 13–17, All Ages**.
2. Fix the bug where selecting a non-default age reverts to **4–6** after clicking **Run now**.

## Root cause of the reset

Two compounding issues in `src/components/admin/ColoringAutopilotCard.tsx` + `supabase/functions/coloring-autopilot-config/index.ts`:

1. **Backend allowlist is too narrow.** `coloring-autopilot-config/index.ts:135` forces `age_band` back to `"4-6"` if it isn't one of `"3-5" | "4-6" | "6-8"`. Any new value silently reverts.
2. **Polling clobbers unsaved edits.** `loadStatus` runs on a 10–20s interval and calls `setCfg({ ...DEFAULTS, ...data.config })`, so the currently-selected value in the UI is overwritten by whatever the server last persisted. `Run now` also triggers `loadStatus()` immediately after — that's the visible "jump back to 4–6" moment.
3. **`Run now` does not persist the current picker value first.** It sends only `manual` + `override_batch`, so the tick uses whatever `age_band` was last saved, not what's currently on screen.

## Changes

### Frontend — `src/components/admin/ColoringAutopilotCard.tsx`
- Widen the `ColoringConfig["age_band"]` union to `"2-4" | "4-6" | "6-8" | "8-12" | "13-17" | "all_ages"`.
- Replace the 3 `<SelectItem>` entries with the 6 storefront-aligned options (labels use the en-dash, `all_ages` → "All Ages").
- Stop clobbering in-progress edits: track a `dirty` ref/flag; when `loadStatus` returns, only merge server config into local state on the initial load or right after a successful `save`. On the polling path, update `status` and `cats` but leave `cfg` alone.
- Make `Run now` save-then-run: `await save(cfg)` first (so the picked age is persisted), then invoke `coloring-autopilot-tick`. Keeps behavior obvious and matches user expectation.

### Backend — `supabase/functions/coloring-autopilot-config/index.ts`
- Update the DEFAULTS and the allowlist at line 135 to accept `"2-4" | "4-6" | "6-8" | "8-12" | "13-17" | "all_ages"`. Fallback stays `"4-6"` only for truly invalid input.

### Backend — `supabase/functions/coloring-autopilot-tick/index.ts` and any downstream age-band consumers (`_shared/coloring/*`, page-plan, concept generator)
- Extend the type union / switch statements that map `age_band` → age-appropriate prompt clauses so `2-4`, `8-12`, `13-17`, `all_ages` route to sensible existing buckets:
  - `2-4` → toddler/simple-shapes clause (reuses current `3-5` complexity floor).
  - `8-12` → tween/detailed clause (reuses current `6-8` upper end, more intricate line-work).
  - `13-17` → teen/advanced-intricate clause.
  - `all_ages` → mixed-complexity clause (accepts wider line-weight range).
- No lowering of QC gates — only prompt-side variation. Species/anatomy contracts unchanged.

### Types
- Reuse `AgeChipSlug` from `src/lib/kidsCatalogTaxonomy.ts` for the picker options so storefront and admin stay in lock-step.

## Out of scope
- Storefront chips (they already show the correct set — see the attached screenshot).
- Any pipeline QC threshold changes.
- Adding new species/anatomy contracts for the wider age range (contract gate still enforces coverage; if a category lacks coverage for the picked age, the existing `assertSpeciesCoverage` blocker fires as designed).

## Verification
- Pick `13–17`, click **Save settings** → reload page → picker still shows `13–17`.
- Pick `8–12`, click **Run now** → toast reports queued book(s); picker stays on `8–12` (no revert after the post-run `loadStatus`).
- Poll tick (20s) with `2–4` selected but unsaved → picker stays on `2–4`; only status pane refreshes.
- New book row's `metadata.age_band` matches the picked value.
