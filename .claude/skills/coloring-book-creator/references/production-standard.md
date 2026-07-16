# Coloring Book Production Standard

End-to-end checklist. Runtime lives under
`supabase/functions/coloring-*` and `supabase/functions/_shared/coloring/*`.

## 1. Concept + category

- Category loaded from `public.coloring_categories` (never inline lists).
- Concept generator obeys forbidden_subjects and the IP guardrails
  (no living-artist style imitation, no recognizable copyrighted
  characters).

## 2. Style contract

- Baseline pulled from the age-band defaults library
  (`_shared/coloring/age-bands.ts`).
- Frozen at calibration and stored on
  `ebooks_kids.metadata.coloring_style_contract`.
- Every prompt composed via `buildInteriorPrompt` — no ad-hoc prompts.

## 3. Page plan

- `generatePagePlan` distributes across the 8-bucket scene taxonomy
  (portrait, full_body, environment, action, relationship, celebration,
  learning, quiet).
- `validatePagePlan` blocks the book on OUT_OF_CATEGORY,
  FORBIDDEN_SUBJECT, DUPLICATE_CONCEPT, OVERUSED_SUBJECT, or
  SCENE_TAXONOMY_UNDERCOVERED (≥5 buckets used; no bucket >35%).

## 4. Calibration (pages 1..4)

- Rendered first, verify-at-birth (PNG/JPEG/WebP magic + min bytes),
  then solid-black gate.
- Pause at `awaiting=owner_calibration_review` at 25 % progress with
  a PDF of the 4 pages for owner sign-off.

## 5. Production (pages 5..N)

- Batches of 6, self-invocation between batches.
- Repair ladder on any failure:
  1. repair (same prompt, new seed, corrective clauses)
  2. revise (structural anatomy / composition clauses)
  3. simplify (single subject, minimal background)
  4. escalate to owner (never silent retire)

## 6. Book-level acceptance

- `coloringBookWeightedGate` (see qc-rubric.md).
- `coloringReleaseGate` requires `book_weighted_gate_pass=true`.

## 7. Cover + PDF + publish

- Textless illustration + SVG typography overlay for cover.
- Interior PDF assembled from stored page PNG/JPEG/WebP.
- `kids-publish-if-qc-passed` is the only path to `listing_status=live`.
