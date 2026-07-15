# Regression fixtures

Add one directory per bug class. Each MUST contain a `run.sh` that exits
nonzero on regression. New classes: `blank-cover`, `character-drift`,
`random-image-text`, `stale-pdf-asset`, `qc-field-mismatch`,
`page-order-regression`, `sales-page-internal-copy-leak`.

A class is "closed" only after its fixture is added and passes both before
and after any subsequent code changes.
