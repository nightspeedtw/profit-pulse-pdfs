## Root cause

The anatomy verifier already detects deformity (missing/extra/floating/fused limbs) — rubric is correct and fantasy beings (unicorns, dragons, mermaids, multi-armed deities, nine-tailed fox, etc.) are explicitly PASSED. But under **Coloring Rulebook v2 "Essentials Only"** the verdict was demoted to **advisory** in `coloring-book-render/index.ts` (line ~667), so deformed pages like the ones you flagged (pp. 7, 14, 27 — unicorns with missing back legs / body cut off / floating torsos) shipped into the PDF.

Uploaded pages show real deformity (not stylization):
- p.7 — right unicorn only 2 legs visible (back legs missing behind the star-cat)
- p.14 — left unicorn body/leg fused into the other unicorn, back legs missing
- p.27 — center unicorn floating, no visible legs under the torso

These are exactly what the rubric already calls "missing / floating / disembodied limbs" — they just weren't enforced.

## Rulebook v2 amendment — `anatomy_deformity_hard_gate_v1`

Add ONE non-waivable hard gate to the coloring interior pipeline:

> **Deformity is a hard reject.** Fantasy species, stylization, cuteness, and canonical mythical forms remain allowed. Only anatomy defects on the creature's OWN canon (wrong count of standard parts, missing/extra/fused/severed/floating/disembodied limbs, mangled proportions) reject the page.

Recognizability + text-contamination (Q2/Q3) already reject — no change.

## Permanent code changes

1. **`supabase/functions/_shared/coloring/anatomy-verify.ts`**
   - Add exported `DEFORMITY_DEFECT_PATTERNS` (regex list: `extra_limb`, `missing_limb`, `fused`, `severed`, `floating`, `disembodied`, `frankenstein`, `wrong.*count`, `mangled`, `crushed`, `twisted`).
   - Add `isDeformityDefect(defect: string): boolean` and `hasDeformity(verdict): boolean`.
   - Bump `ANATOMY_VERIFIER_VERSION` → `v6:deformity_hard_gate` so cached advisory verdicts re-measure.

2. **`supabase/functions/coloring-book-render/index.ts`** (the advisory branch at ~line 667)
   - Split the failing verdict into two paths:
     - `hasDeformity(v)` → **reject**: delete storage object, decrement page from `newRecords`, log `anatomy_gate` (not `anatomy_advisory`), bump per-page attempts, feed into existing `anatomy_structural` repair ladder with `speciesAnatomyRepairClause(subject)` appended to the next prompt.
     - other defects (blob/egg/unrecognizable/text) keep current handling.
   - Cap at 3 anatomy re-renders per page; then park the book with reason `anatomy_deformity_unrecoverable` for owner review (never silently ship).

3. **Regression test** — `src/__tests__/coloring-anatomy-deformity-hard-gate.test.ts`
   - Given a verdict with `defects: ["missing_limb: back legs absent"]`, the render pipeline must reject and NOT emit an advisory pass.
   - Given `defects: ["eyelashes on unicorn"]` (stylization), must pass.
   - Given a unicorn (fantasy), no rejection on horn/wings.

## One-off fix for the latest book

Target: `d6da92a8-5eaa-455e-9d00-8b8780cae9d1` ("Superhero Unicorn Fantasy Coloring Book").

1. Query `ebook_pages_kids` for the book's interior pages, download each storage object.
2. Run `verifyAnatomyBatch` (new v6 rubric) against all interior pages in one pass.
3. For every page where `hasDeformity(verdict) === true`:
   - Delete the storage object.
   - Clear the page's `image_url` / mark `needs_rerender=true`.
   - Enqueue only that page through the existing `anatomy_structural` repair ladder (prompt gets `speciesAnatomyRepairClause('unicorn')` appended: "must show all four legs, no fused bodies, no floating torsos, full canonical form visible").
4. When all flagged pages return `pass=true`, re-run `coloring-book-assemble` → republish.
5. Do **not** re-render pages that already pass — cost-bounded and preserves the good art.

Expected: pp. 7, 14, 27 (and any siblings the verifier flags) regenerate with complete four-legged unicorns; the rest of the book is untouched; book returns to `live` with the same cover.

## Files to edit

- `supabase/functions/_shared/coloring/anatomy-verify.ts` — add taxonomy helpers, bump version
- `supabase/functions/coloring-book-render/index.ts` — split advisory vs hard-reject on deformity
- `src/__tests__/coloring-anatomy-deformity-hard-gate.test.ts` — regression fixture
- `.lovable/coloring-rulebook-v2-amendments.md` — record `anatomy_deformity_hard_gate_v1`
- `pipeline_skills` row — register the amendment

## Out of scope

- No changes to Q2 (recognizability) or Q3 (text) — already hard gates.
- No changes to the cover pipeline.
- No threshold lowering anywhere. Fantasy remains fully allowed.
