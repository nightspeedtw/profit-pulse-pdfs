# Regression Evaluation and Permanent-Fix Proof

## Objective

Make every recurring defect a test fixture. Do not let “fixed” mean “one run happened to pass.”

## P0 rule

A defect is P0 when:

- a previously fixed class returns
- valid books are repeatedly retired
- new production burns cost without progress
- PDF/QC data is contradictory
- duplicate or corrupted books reach the storefront
- publication occurs with a hard-gate failure

On P0:

1. pause new production
2. allow safe active steps to checkpoint
3. preserve logs and artifacts
4. reproduce the defect
5. add a failing fixture
6. repair every path
7. validate original fixture
8. validate three fresh books
9. resume only after proof

## Required fixture classes

Maintain fixtures for:

- blank or title-only cover
- duplicate pages after retry
- duplicate chunks after merge
- character drift
- cover/interior style mismatch
- random text or watermark in image
- missing story dependency
- stale or expired PDF asset
- QC field mapping mismatch
- technical failure converted to score zero
- incorrect page chronology
- internal brief leaked to public copy
- storefront metadata mismatch
- concurrent repair race

## Test layers

### Unit

- state transition functions
- field mappings
- score policy
- page uniqueness
- financial/metadata calculations

### Integration

- producer persistence and gate reload
- renderer asset and QC asset hash equality
- retry replacing the same page
- resume from last good step
- public data sanitization

### End to end

Generate a book from a fresh concept with no manual database edits.

For illustrated books verify:

- Story Bible and references exist
- cover and interior use the same reference version
- all pages are unique and ordered
- PDF opens
- metadata matches
- sales page is sanitized

## Three-book proof

A permanent-fix claim requires three consecutive fresh books:

```text
Book A: PASS
Book B: PASS
Book C: PASS
```

Reset the consecutive count on any hard-gate failure.

Use category diversity when relevant so the test is not three near-identical prompts.

## No cheating proof

The release manifest must show:

```text
manual_db_edits = 0
threshold_reductions = 0
gate_bypasses = 0
placeholder_assets = 0
```

Review the git diff for threshold and gate changes.

## Cycle time and cost

Record:

- total duration
- duration by step
- provider calls
- repair attempts
- rerender count
- cost by step

Reliability comes before throughput, but regressions that multiply cost must be visible.

## Completion statement

Use only one of these:

- `diagnosed`
- `code_fix_implemented`
- `fixture_passed`
- `fresh_book_1_of_3_passed`
- `fresh_book_2_of_3_passed`
- `permanent_fix_verified`

Do not use “permanent” before the final state.
