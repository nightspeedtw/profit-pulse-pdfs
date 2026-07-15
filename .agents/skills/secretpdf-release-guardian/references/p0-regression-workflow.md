# P0 Regression Workflow

## Trigger conditions

Declare P0 when any of these occur:

- a defect previously recorded as fixed returns;
- production runs all day without producing valid books;
- Fix All repeats the same repair with unchanged output;
- a valid asset receives a false-zero quality score;
- duplicate pages or stale assets recur;
- multiple workers mutate the same book concurrently;
- public listings expose defective or internal content.

## Incident sequence

1. Pause new-book creation and preserve in-flight checkpoints.
2. Capture the complete error, stack, run ID, book ID, step ID, attempt, worker, model, prompt version, asset IDs, and hashes.
3. Reproduce with the smallest fixture.
4. Audit all entry points, not only the path that surfaced the error.
5. Identify the shared defect class.
6. Add a failing regression test.
7. Patch the canonical implementation; quarantine legacy paths.
8. Run unit, integration, migration, typecheck, build, and end-to-end tests.
9. Resume the original fixture from the first invalid step.
10. Run three fresh consecutive books in sequential-safe mode.

## Anti-loop policy

Store a repair fingerprint:

- gate/rule IDs;
- input artifact hash;
- output artifact hash;
- score vector;
- repair strategy;
- attempt number.

If two attempts produce the same output hash or no score improvement, stop repeating the strategy. Classify the issue as code/persistence/contract failure and create a targeted engineering task.

## Exit criteria

Close P0 only when:

- the original fixture passes;
- three fresh books pass consecutively;
- no manual DB edits are used;
- no threshold is reduced;
- no gate is bypassed;
- logs show one canonical owner per book;
- final PDFs open and match recorded hashes;
- public metadata matches final artifacts.
