# Coloring Book Mode — canonical modules

**Status: dev build complete; pilot generation blocked until P0 closes.**

## Files
- `supabase/functions/_shared/coloring/category.ts` — DB loader + subject gating.
- `supabase/functions/_shared/coloring/style-contract.ts` — locked style contract + `buildInteriorPrompt` (composes canonical textless directive).
- `supabase/functions/_shared/coloring/page-plan.ts` — deterministic page plan generator + validator (category-match, uniqueness, distribution).
- `supabase/functions/_shared/coloring/gates.ts` — page/cover/release QC gates + hard-fail zero classes. **Do not lower thresholds.**
- `supabase/functions/coloring-book-start/index.ts` — creates queued `ebooks_kids` row with `book_type='coloring_book'`, Theme Bible, page plan, locked style contract. Does NOT begin generation.

## Data model
- `ebooks_kids.book_type ENUM('picture_book','coloring_book')` — discriminator.
- `public.coloring_categories` — persisted category specs (allowed/forbidden subjects, style, complexity, age band, trim, page count).
- Theme Bible, page plan, style contract, workflow version all live on `ebooks_kids.metadata` (JSONB), so the existing identity-lock trigger and one-row-per-book invariant apply automatically.

## Reused canonical infra (no duplication)
- Textless policy: `_shared/textless-illustration-policy.ts` (verbatim).
- Skill router: `_shared/skill-router.ts` via `supported_book_types=['coloring_book']`.
- Idempotent page writes: same `canonical_page_number` contract as picture books.
- Cover/thumbnail generation: reuse existing `kids-repair-cover`, `generate-photoreal-thumbnail`, `generate-store-thumbnail`.
- Release validation: `secretpdf-production-suite/scripts/validate_release_manifest.py`.

## Pilot (queued, NOT executed)
`sea_animals` category seeded. To queue the pilot row post-P0:

```
POST /functions/v1/coloring-book-start
{ "category_key": "sea_animals", "title": "Ocean Friends Coloring Adventure" }
```

Row is inserted with `pipeline_status='queued'` and `metadata.awaiting='p0_close_before_generation'` — orchestrator will not pick it up while P0 fixture #12 + 3 fresh-book proofs remain the active production work.

## Deviations from spec (owner adapt-don't-copy rule)
1. **JSONB storage** for Theme Bible / page plan / style contract on `ebooks_kids.metadata` — spec said "persist per book" without prescribing a shape. Why: matches Story Bible pattern; single identity row; existing immutability trigger covers it.
2. **Single `coloring_categories` table** rather than JSONB — categories are reusable across books.
3. **Branch inside canonical orchestrator** (not a new orchestrator) — per canonical-orchestrator rule.
4. **Deterministic page-plan generator** (seedable RNG + subject/composition/scene cycling) instead of an LLM call for the plan — cheaper, reproducible, easier to prove uniqueness.
5. **Calibration / interior-render / PDF-build edge functions deferred**: no benefit to writing them before P0 unblocks; the shared modules, gates, and Category+Bible+Plan contract they will consume all exist and are tested.

## Not yet written (blocked on P0)
- `coloring-calibration`, `coloring-render-page`, `coloring-build-pdf` edge functions.
- Orchestrator branch in `autopilot-kids-orchestrator`.
- Release-manifest schema extension for coloring.
- Storefront product-page adaptation for `book_type='coloring_book'` (no live products yet).

These land the day P0 closes — the contracts they depend on are already frozen and tested.
