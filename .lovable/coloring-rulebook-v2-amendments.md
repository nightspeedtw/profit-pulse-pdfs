# Coloring Rulebook v2 — Amendments

## anatomy_deformity_hard_gate_v1 (2026-07-19)

**Owner order.** Coloring interior pages must not ship with deformed characters.

- **Hard reject** (non-waivable): missing / extra / fused / severed / floating /
  disembodied limbs; wrong count of a creature's standard parts (5 legs on a
  4-legged animal, 6 fingers on a human, 3 arms, floating torso, mangled body).
- **Still allowed**: every fantasy species (unicorn, dragon, mermaid,
  multi-armed deities, nine-tailed fox, phoenix, naga, garuda, kirin, kinnari,
  erawan/airavata, pegasus, hybrids), cuteness, stylization, big eyes,
  eyelashes, blush, bows, chibi proportions.

Enforcement lives in `supabase/functions/coloring-book-render/index.ts` — a
deformed verdict deletes storage and drops the page from `newRecords`, so the
existing repair ladder re-renders only the failing page. Cap: 3 anatomy
re-renders per page before the book is parked with
`blocker_reason=anatomy_deformity_unrecoverable`.

Verifier version bumped to `v6:deformity_hard_gate` so cached advisory
verdicts re-measure under the new enforcement.

Regression test: `src/__tests__/coloring-anatomy-deformity-hard-gate.test.ts`.
