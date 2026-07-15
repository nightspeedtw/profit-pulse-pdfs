---
name: secretpdf-regression-eval-harness
description: Use to execute SecretPDF regression proofs — run per-bug-class fixtures (blank-cover, duplicate-page-retry, character-drift, random-image-text, stale-pdf-asset, qc-field-mismatch, page-order-regression, sales-page-internal-copy-leak), compose the release manifest, run clean install + typecheck + unit tests + build, prove three consecutive fresh books, and block use of the word "fixed" without complete evidence. release-guardian is policy; this skill is the execution engine.
---

# SecretPDF Regression Eval Harness

Policy comes from `secretpdf-release-guardian`. Execution comes from here.

## Fixtures (`fixtures/<class>/`)
Each fixture directory contains:
- `README.md` — one-line class description + reproduction steps.
- `input/` — deterministic inputs (JSON, seed PDFs, ledger snapshots).
- `expected/` — the verdict/hash the detector must produce.
- `run.sh` — invokes the relevant integrity script(s) against `input/`.

Classes shipped with this skill (extend as new bug classes appear):
`blank-cover`, `duplicate-page-retry`, `character-drift`, `random-image-text`,
`stale-pdf-asset`, `qc-field-mismatch`, `page-order-regression`, `sales-page-internal-copy-leak`.

## Suites
- `scripts/run-regression-suite.py` — runs every `fixtures/*/run.sh`; writes
  `artifacts/regression-suite.json` with per-fixture pass/fail; exits nonzero
  on any failure.
- `scripts/run-clean-build.sh` — clean install, typecheck (`bunx tsgo --noEmit`),
  vitest (`bunx vitest run`), production build.
- `scripts/build-release-manifest.py` — assembles the manifest from
  regression + clean-build + fresh-book results, then invokes
  `.claude/skills/secretpdf-release-guardian/scripts/validate_release_manifest.py`.

## Proof set required to write `p0_closed: true`
1. clean install ✓
2. typecheck ✓
3. unit tests ✓ (including every regression fixture)
4. build ✓
5. original fixture repaired ✓
6. three consecutive fresh books reach `final_pdf_ready` ✓
7. manual DB edits = 0
8. threshold reductions = 0
9. gate bypasses = 0

Any missing → the harness writes the manifest with `p0_closed: false` and
refuses the closing verdict. Never edit the manifest by hand.

## Language rules
- Do not use "fixed", "done", "permanent", or "resolved" in status text until
  the harness has passed end-to-end.
- Use "landed", "in place", or "under proof" while proof is incomplete.
