# Productionize Kids Autopilot + Fresh End-to-End Run

Goal: turn the flow that shipped *The Sneeze-Powered Sock Sorter* into the default kids production path, expose one admin action, and smoke-test it by publishing one brand-new picture book — only if strict measured QC passes.

## Part 1 — Lock production defaults (code)

Edit `supabase/functions/autopilot-kids-pipeline/index.ts` (+ helpers) so every new kids run follows the exact sequence that worked:

```text
concept → manuscript → story judge gate → metadata sync
  → metadata/story mismatch gate → bible_check → style bible lock
  → textless cover master → deterministic illustrated title treatment (baked PNG)
  → 12 interior illustrations → 3 previews
  → multi-stage PDF (prepare → 1_4 → 5_8 → 9_12 → finalize)
  → measured kids QC → publish-if-qc-passed (Internal Store only)
```

Concrete changes:
- **Default style**: `_shared/style-picker.ts` / kids preset resolver → primary `watercolor_soft`, fallback `warm_storybook_gouache`. Remove `pixar_3d` from the kids default pool (keep selectable, not default).
- **Story gate before art**: pipeline halts at `story judge` with the exact thresholds listed (age_appropriateness ≥90, story_coherence ≥90, emotional_payoff ≥85, reread_value ≥85, language_level ≥90, parent_buyer_value ≥85, generic_story_risk ≤25). No image spend until pass.
- **Story judge cache**: reuse `storefront_meta.story_judge_cache` keyed by manuscript hash (helper already exists in `_shared/manuscript-hash.ts`). Skip re-run on hash match with a prior pass.
- **Cover**: always textless master + deterministic illustrated title treatment baked into `cover.png`; same file used as thumbnail; persist `storefront_meta.title_treatment`; fail `KIDS_TITLE_TREATMENT_INVALID` on metadata/title mismatch.
- **PDF**: default to the multi-stage builder (`kids-build-picture-pdf`) chained into `kids-publish-if-qc-passed`. Retire the single-shot path from the default flow.
- **Measured QC**: the full critical-gate list (story pass, metadata gate, bible_check, title treatment, cover title spelling, character_consistency ≥90, cover_interior_match ≥90, style_bible_match ≥90, 12+ unique interiors, thumbnail, 3+ previews, valid PDF with extractable text, no glyph mangling, no placeholder art). No threshold is lowered.

## Part 2 — Admin one-click action

- Confirm `BuildKidsBookButton` (already exists) is mounted on **Kids Autopilot** (`src/pages/admin/KidsAutopilot.tsx`) with defaults preset to age band `4-6`, high illustration intensity, mode `full`, Internal Store only.
- Rename displayed label to `Build Kids Picture Book`.
- Show live per-stage progress (already rendered from `autopilot_kids_runs` / `autopilot_kids_steps`), blocker reason, and final Store URL.
- No marketing/landing UI added.

## Part 3 — Fresh end-to-end run

- Invoke `kids-book-start` with: age band `picture-book-4-6`, themes in a fresh lane (daytime funny adventure / animal buddy comedy / food-kitchen chaos / silly invention). Excluded lanes: bedtime, moon/star, emotion-regulation-only, tooth/bathroom, wormhole/portal, sock-sorter repeat.
- Illustration intensity `high`, length `standard`, price `standard`, mode `full`.
- Let the pipeline run. If any gate fails, keep `listing_status=draft`, `sellable=false`, report exact blocker + next repair action.
- If all gates pass, publish to Internal Store and return the URL.

## Validation

- `tsgo` typecheck.
- Grep confirmations: no Shopify calls, no seeded/fake reviews, default kids style ≠ `pixar_3d`, story gate wired before any image generator, PDF path uses the multi-stage builder.
- Verify fresh run either publishes after QC or stays draft with a recorded blocker.

## Report back

Changed files, deployed functions, admin button confirmation, defaults locked, new ebook ID, title/subtitle/description, story judge scores, style slug, cover/thumbnail/PDF/preview URLs, page + illustration counts, price, measured QC scorecard, `listing_status`, `sellable`, Internal Store URL (if live), guardrail confirmations, and (if blocked) exact next blocker.
