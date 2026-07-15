---
name: secretpdf-production-suite
description: End-to-end engineering and quality-control workflow for the SecretPDF book factory. Use when Codex must audit or repair the repository, unify book-generation orchestration, fix QC producer-persistence-gate mismatches, stop recurring Fix All loops, validate PDF integrity, enforce illustrated-character continuity, design premium covers and ecommerce thumbnails, create sanitized high-converting sales copy, add observability, clean legacy code, or prove a permanent fix with regression tests and fresh-book acceptance runs.
---

# SecretPDF Production Suite

Build a production system, not a demo. Repair defect classes, preserve evidence, and prove release quality without lowering thresholds or bypassing gates.

## Non-negotiable rules

- Audit the actual repository before changing production behavior.
- Fix root causes across every trigger and worker; never patch one ebook row as the solution.
- Keep one canonical orchestrator, state machine, data contract, and asset resolver.
- Never lower a QC threshold, fabricate a score, mark missing data as passed, or manually edit a score to release a book.
- Treat missing dependencies and technical asset failures as technical states, not quality score `0`.
- Make retries idempotent: replace the same logical artifact version; never append a duplicate page.
- Use bounded repairs and truthful terminal states. Do not loop forever.
- Block release when any hard gate fails.
- Do not call a defect permanently fixed until the original fixture and three consecutive fresh books pass.

## Choose the workflow

1. **Repository, pipeline, queue, state, or dead-code issue**  
   Read `references/architecture-orchestrator.md`.
2. **QC is `n/a`, inconsistent, or repeats after repair**  
   Read `references/qc-contracts.md`.
3. **PDF is missing, invalid, duplicated, stale, misordered, or metadata does not match**  
   Read `references/pdf-integrity.md`.
4. **Recurring regression or claim of permanent fix**  
   Read `references/regression-evals.md` and `references/release-gates.md`.
5. **Stuck jobs, unclear status, concurrency, or P0 incident**  
   Read `references/observability-p0.md`.
6. **Children's book, illustrated story, visual novel, character drift, or cover/interior mismatch**  
   Read `references/illustrated-continuity.md`.
7. **Cover, A4 cover page, storefront thumbnail, mockup realism, or visual diversity**  
   Read `references/cover-thumbnail.md`.
8. **Product page, preview, description, CTA, metadata, or internal notes leaking publicly**  
   Read `references/sales-page-copy.md`.
9. **Installing or invoking this skill in Codex**  
   Read `references/codex-integration.md`.
10. **A defect resembles a previously observed SecretPDF failure**  
    Read `references/known-regressions.md`.

## Core execution sequence

### 1. Establish evidence

- Capture the run ID, book ID, entry point, current step, full error, input/output asset IDs, versions, hashes, and database fields.
- Preserve failing records and artifacts. Do not delete evidence during diagnosis.
- Reproduce the smallest failing case before editing code.

### 2. Map the system

- Run `scripts/audit_repo.py <repo>`.
- Build the trigger-to-orchestrator-to-worker call graph.
- Identify the canonical book, run, step, page, asset, QC, and sales-page records.
- List duplicate or legacy paths and quarantine them behind feature flags before deletion.

### 3. Classify the defect

Use exactly one primary class:

- `content_quality_failure`
- `missing_dependency`
- `temporary_provider_error`
- `quota_wait`
- `persistence_contract_bug`
- `asset_identity_bug`
- `idempotency_bug`
- `state_machine_bug`
- `concurrency_bug`
- `public_copy_leak`
- `non_recoverable_config`

Do not send code bugs to a writing prompt or content-learning loop.

### 4. Write a failing regression test

- Add a deterministic fixture for the defect class.
- Confirm the test fails before the fix.
- Repair every code path that can create the same failure.
- Confirm the test passes after the fix.

### 5. Repair and resume

- Preserve valid upstream work.
- Repair only the failed dependency or artifact.
- Reload persisted data and recompute gates from the canonical record.
- Resume from the first incomplete required step.

### 6. Verify release quality

- Run deterministic PDF/page validators.
- Run measured visual and editorial QC.
- Build a release manifest matching `references/release-gates.md`.
- Run:

```bash
python .agents/skills/secretpdf-production-suite/scripts/validate_release_manifest.py \
  artifacts/secretpdf-release-manifest.json
```

A nonzero exit code means the work remains blocked.

## Production modes

### Phase 1: PDF-only reliability

Default to:

- one heavy-production book at a time
- one PDF render at a time
- no Shopify, SEO, royalty, payment, or publishing dependencies
- final state: `final_pdf_ready`

Disable later phases with explicit feature flags. Missing later-phase credentials must not block Phase 1.

### Illustrated-book mode

Require this immutable chain:

```text
Story Bible
→ Character Bible
→ Character Reference Sheet
→ Style Bible
→ Cover Master
→ Page Plan
→ Interior Illustrations
→ Layout
→ Final PDF
→ Verified Metadata
→ Sanitized Sales Page
```

Do not generate cover and interior art as independent tasks.

## Required completion report

Always report:

1. Root cause and defect class
2. Entry points and code paths audited
3. Canonical data and asset contracts selected
4. Files and migrations changed
5. Regression tests added
6. Clean install, typecheck, tests, and build results
7. Original fixture result
8. Three fresh-book results
9. Remaining blockers and exact states
10. Release-manifest validator result

Do not use “fixed”, “done”, or “permanent” unless the release manifest passes.
