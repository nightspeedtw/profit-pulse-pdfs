
# Coloring Book Mode — Dev Build Plan

**Sequencing:** All code/schema/spec work below lands NOW. Pilot ("Ocean Friends Coloring Adventure", sea_animals, 32 pp) does **not** run until P0 closes (fixture #12 + 3 consecutive fresh-book proofs + `validate_release_manifest.py` exit 0). Production lane stays owned by kids picture-book P0.

## Audit result (reuse, don't duplicate)

| Capability | Status | Decision |
|---|---|---|
| `book_type` discriminator on `ebooks_kids` | ❌ missing (only picture-book track exists) | Add `book_type` enum column (default `picture_book`, new value `coloring_book`) |
| Category taxonomy | ✅ `kids_themes`, `book_series` exist but themed for stories | Add new `coloring_categories` table (self-contained spec) + storefront `categories` row "Coloring Books" |
| Age-band table | ✅ `kids_age_groups` | Reuse |
| Textless policy | ✅ `_shared/textless-illustration-policy.ts` | Reuse verbatim for interior pages |
| Visual bible / style lock | ✅ `_shared/kids-visual-bible.ts` (has `coloring_method` field) | Extend with `LineArtStyleContract` (thickness range, complexity, background, etc.) |
| Skill router / book_type gating | ✅ `_shared/skill-router.ts` supports `supported_book_types[]` | Register `coloring_book` type; route to new skills |
| Orchestrator (`autopilot-kids-orchestrator`) | ✅ canonical | Add branch: if `book_type='coloring_book'` → coloring pipeline steps |
| Idempotent page writes (canonical_page_number) | ✅ used by kids-render-interior | Reuse |
| PDF assembly (`kids-build-picture-pdf`) | ✅ | Fork to shared assembler + coloring assembler (no story text overlay) |
| Cover generation (`kids-repair-cover`, `generate-cover`) | ✅ | Reuse image-gen; add coloring cover typography overlay contract |
| Thumbnail / product mockup | ✅ `generate-photoreal-thumbnail`, `generate-store-thumbnail` | Reuse |
| QC gates (`_shared/qc/*`) | ✅ picture-book gates | Add `_shared/qc/coloring.ts` with the 8 gates + hard-fail zeros |
| Release manifest validator | ✅ `secretpdf-production-suite/scripts/validate_release_manifest.py` | Extend schema for coloring release |

**No second pipeline.** Coloring is a branch inside the canonical kids pipeline discriminated by `book_type`.

## Schema (single migration)

```sql
-- 1. Discriminator
CREATE TYPE public.kids_book_type AS ENUM ('picture_book','coloring_book');
ALTER TABLE public.ebooks_kids
  ADD COLUMN book_type public.kids_book_type NOT NULL DEFAULT 'picture_book';

-- 2. Category spec (persisted, not hard-coded)
CREATE TABLE public.coloring_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text UNIQUE NOT NULL,        -- 'sea_animals'
  category_name text NOT NULL,
  category_description text NOT NULL,
  target_age_min int NOT NULL,
  target_age_max int NOT NULL,
  allowed_subjects text[] NOT NULL,
  allowed_supporting_elements text[] NOT NULL,
  forbidden_subjects text[] NOT NULL,
  line_art_style text NOT NULL,
  complexity_level text NOT NULL,           -- 'simple'|'medium'|'complex'
  background_complexity text NOT NULL,
  trim_size text NOT NULL DEFAULT '8.5x11',
  coloring_page_count int NOT NULL DEFAULT 32,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.coloring_categories TO anon, authenticated;
GRANT ALL ON public.coloring_categories TO service_role;
ALTER TABLE public.coloring_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read coloring categories" ON public.coloring_categories FOR SELECT USING (true);

-- 3. Theme Bible + Page Plan + locked contract stored in ebooks_kids.metadata
--    under keys: coloring_theme_bible, coloring_page_plan, coloring_style_contract,
--    coloring_calibration_result, coloring_workflow_version.
--    Reuses existing JSONB column — no new column.

-- 4. Storefront category row for "Coloring Books" (seed via insert tool later,
--    kept out of migration so it can be adjusted per copy)
```

## New shared modules (canonical, imported by branch)

- `supabase/functions/_shared/coloring/category.ts` — types + loader for `coloring_categories`; `assertSubjectInCategory()`.
- `supabase/functions/_shared/coloring/style-contract.ts` — `LineArtStyleContract` interface + `buildInteriorPrompt(page, contract, category)` (composes with `TEXTLESS_DIRECTIVE`).
- `supabase/functions/_shared/coloring/page-plan.ts` — `generatePagePlan(category, count)` + `validatePagePlan()` (category-match, concept-uniqueness via subject/scene/composition tuple, complexity, subject-distribution).
- `supabase/functions/_shared/coloring/gates.ts` — 8 QC thresholds + hard-fail zeros; `coloringPageGate()`, `coloringCoverGate()`, `coloringReleaseGate()`.
- `supabase/functions/_shared/coloring/release-manifest.ts` — manifest shape consumed by `validate_release_manifest.py`.

## New edge functions (thin — reuse existing image/PDF workers)

- `coloring-book-start` — creates `ebooks_kids` row with `book_type='coloring_book'`, resolves category, writes Theme Bible + initial workflow version.
- `coloring-calibration` — generates 4 calibration pages (simple / medium scene / two-subject / max-complexity), runs `coloringPageGate`, LOCKS style contract + workflow version + prompt version + model config on pass; on fail iterates prompt without lowering gates.
- `coloring-render-page` — generates one canonical page under locked contract; idempotent by `(ebook_id, canonical_page_number)`; regenerate replaces version, never appends.
- `coloring-build-pdf` — assembles cover → copyright → optional color-test → 32 pages → optional closing. Reuses picture-pdf primitives; strips story-caption overlay path.
- Orchestrator branch inside `autopilot-kids-orchestrator`: `book_type='coloring_book'` → start → theme-bible → page-plan → calibration → interior-loop → cover → pdf → thumbnail → release-gate.

## Skill router + skills

Register three `runtime_skill_contracts` rows with `supported_book_types=['coloring_book']`:
- `coloring_page_prompt_v1`
- `coloring_cover_prompt_v1`
- `coloring_page_plan_v1`

Learner path stays available for craft improvements but never lowers gates.

## Tests (fail before, pass after)

- `src/lib/coloringPagePlan.test.ts` — 32 unique pages, all subjects in `allowed_subjects`, no `forbidden_subjects`, distribution rules.
- `src/lib/coloringStyleContract.test.ts` — `buildInteriorPrompt` always contains textless directive, style lock tokens, no story-mode leakage.
- `src/lib/coloringGates.test.ts` — hard-fail zero classes reject, threshold arithmetic correct, release gate composes.
- `supabase/functions/_shared/coloring/page-plan.test.ts` — duplicate detection, category-match fail.

## Storefront

- Add `categories` row `slug='coloring-books'` (via insert tool after migration).
- Add "Coloring Books" tile to `src/components/CategoryGrid.tsx` (icon: Palette or new). Product page reuses existing kids product template; only render caption-free preview for `book_type='coloring_book'`.

## Pilot (queued, NOT executed)

Written as an idempotent seed script `scripts/seed-coloring-pilot.ts` that inserts the `sea_animals` category row + a queued `ebooks_kids` row with `pipeline_status='queued'` and `book_type='coloring_book'`. Row stays queued behind Sequential Safe Mode until P0 closes; owner runs `coloring-calibration` manually as the first act post-P0.

Category seed (`sea_animals`):
- allowed: seahorse, dolphin, whale, shark, sea turtle, octopus, jellyfish, crab, lobster, starfish, tropical fish, manta ray, seal, narwhal, squid, clownfish, pufferfish
- supporting: coral, seaweed, shells, bubbles, sand, underwater rocks, treasure chest, underwater plants
- forbidden: land/farm animals, vehicles, dinosaurs, unrelated humans, fantasy
- style: "Clean friendly children's coloring-book line art, thick smooth black contour lines, rounded forms, large closed coloring spaces, minimal interior shading, simple expressive faces, pure white background"
- age 4–6, 32 pages, 8.5×11 portrait.

## Deviations from spec (owner adapt-don't-copy rule)

1. **Theme Bible + Page Plan stored in `ebooks_kids.metadata` JSONB**, not new tables. Why: matches how Story Bible is stored; one row = one book identity; keeps immutability trigger coverage automatic.
2. **`coloring_categories` is a real table** (spec called for "persist per category" without saying where). Why: categories are reusable across many books and need admin CRUD; JSONB per-book would duplicate.
3. **No new orchestrator** — branch inside `autopilot-kids-orchestrator` on `book_type`. Why: canonical-orchestrator rule; avoids second state machine.
4. **Release manifest schema extended, not forked**. Why: `validate_release_manifest.py` is the single release gate.

## Out of scope for this task

- Running the pilot (blocked on P0).
- Additional categories (Dinosaurs, Construction Vehicles) — future short-form commands after pilot proves the pipeline.
- Publishing (Shopify/payments) — still Phase 2+.

## Definition of done for THIS task

- Migration applied, GRANTs verified, seed category present.
- New shared modules + branch code merged.
- All new tests green, typecheck + build clean.
- Storefront tile visible; no live coloring products yet.
- Pilot row exists in `queued` state, marked "awaiting P0 close" in metadata.
- P0 fixture #12 + 3 proofs remain the ONLY active production work.
