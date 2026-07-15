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

**For every book generation, PDF, QC, illustrated continuity, regression,
or storefront issue, invoke: `$secretpdf-release-guardian` (policy) and
the matching execution skill from `.agents/skills/`.**

## Skill routing (all under `.agents/skills/` and mirrored to `.claude/skills/`)

| Symptom / task | Skill |
|---|---|
| Architecture audit, duplicate orchestrators, canonical tables | `secretpdf-repo-architect` |
| State machine, retries, leases, resume, error classification | `secretpdf-pipeline-orchestrator` |
| Any QC gate: contract, n/a, threshold, repair loop | `secretpdf-qc-contract-auditor` |
| PDF bytes, duplicates, page order, metadata, cover blank | `secretpdf-pdf-integrity-engineer` |
| Regression fixtures, release manifest, fresh-book proof | `secretpdf-regression-eval-harness` |
| Illustrated / kids continuity, character lock, scene contract | `secretpdf-illustrated-continuity-director` |
| Watermark / random text / signature inside AI images | `secretpdf-image-artifact-guard` |
| Structured logs, recurring regression, P0 pause-prove-resume | `secretpdf-observability-p0-responder` |
| Release policy + language ("fixed" gating) | `secretpdf-release-guardian` |

Scoped AGENTS.md files live under `supabase/functions/` and `src/`;
workflows live in the skill files, not here.

## Deferred (do NOT author until 3-consecutive-fresh-books proof passes)
- `sales-page-conversion-guardian`
- `shopify-publisher`
- `royalty-ledger-auditor`
- `seo-merchandising`
