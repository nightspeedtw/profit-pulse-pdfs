# AGENTS.md — SecretPDF root policy

**Phase 1 = complete illustrated PDF generation only.** Do not touch
Shopify, SEO, royalty, trading, or publishing code unless the task
explicitly enables that phase.

## Non-negotiable rules

- Never lower a quality threshold.
- Never bypass a gate.
- Never hand-edit a QC score, verdict, or scorecard row.
- Never call a defect "fixed", "done", or "permanent" without a regression
  test that fails before the change and passes after.
- Repair the defect **class**, never one book row.
- Missing dependencies are not quality failures. Technical asset failures
  never become a score of 0.
- Retry replaces artifact versions; it never appends a duplicate page.
- Preserve P0 evidence — do not delete failed records or overwrite assets.
- Before completion: clean install, typecheck, unit tests, build must all pass.
- Closing a permanent-fix task requires three consecutive fresh books
  reaching `final_pdf_ready` with 0 manual DB edits, 0 threshold
  reductions, 0 gate bypasses.

**Canonical skill: `secretpdf-production-suite`** — consolidated policy +
deterministic scripts (`validate_release_manifest.py`,
`validate_page_manifest.py`, `audit_repo.py`) + references covering
architecture-orchestrator, qc-contracts, pdf-integrity, regression-evals,
observability-p0, illustrated-continuity, cover-thumbnail, sales-page-copy,
release-gates, known-regressions. For every book-generation, PDF, QC,
illustrated-continuity, regression, observability, or storefront-copy task,
load this suite first and follow the reference for the matching sub-workflow.

## Skill routing → `secretpdf-production-suite`

| Symptom / task | Load |
|---|---|
| Architecture, duplicate orchestrators, canonical tables, state machine, retries | `references/architecture-orchestrator.md` |
| QC gate contracts, n/a fields, threshold audits, repair loops | `references/qc-contracts.md` |
| PDF bytes, duplicates, page order, metadata drift, blank cover | `references/pdf-integrity.md` + `scripts/validate_page_manifest.py` |
| Regression fixtures, release manifest, fresh-book proof | `references/regression-evals.md` + `scripts/validate_release_manifest.py` |
| Illustrated continuity, character lock, scene contract, cover/interior match | `references/illustrated-continuity.md` |
| Covers, A4 cover pages, thumbnails, mockup realism | `references/cover-thumbnail.md` |
| Sales page, storefront copy, leak of internal notes | `references/sales-page-copy.md` |
| Stuck jobs, concurrency, P0 incident triage | `references/observability-p0.md` |
| Release language ("fixed" gating), acceptance | `references/release-gates.md` |
| Recurring failure look-up | `references/known-regressions.md` |

The earlier per-skill packages (`secretpdf-repo-architect`,
`-pipeline-orchestrator`, `-qc-contract-auditor`, `-pdf-integrity-engineer`,
`-regression-eval-harness`, `-illustrated-continuity-director`,
`-image-artifact-guard`, `-observability-p0-responder`,
`-release-guardian`) remain installed for back-compat but the suite is now
canonical — do not author duplicates. Scoped AGENTS.md files live under
`supabase/functions/` and `src/`.

## Deferred (do NOT author until 3-consecutive-fresh-books proof passes)
- `sales-page-conversion-guardian`
- `shopify-publisher`
- `royalty-ledger-auditor`
- `seo-merchandising`
