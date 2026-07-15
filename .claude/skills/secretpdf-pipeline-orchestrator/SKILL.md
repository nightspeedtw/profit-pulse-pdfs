---
name: secretpdf-pipeline-orchestrator
description: Use when designing, modifying, or debugging the SecretPDF book-generation state machine — orchestrator entry, dependency guards, sequential-safe mode, production leases, retry/resume, stale-run recovery, error classification (content_quality_failure / dependency_missing / temporary_provider_error / quota_wait / persistence_bug / state_machine_bug / asset_access_bug / non_recoverable_config), and idempotent step execution. Does NOT own QC gate contracts (see qc-contract-auditor) or PDF byte checks (see pdf-integrity-engineer).
---

# SecretPDF Pipeline Orchestrator

One canonical state machine owns the lifecycle. Every trigger — button, cron, watchdog, repair worker, chained self-invoke — enters through the same orchestrator and drives the same state transitions.

## Canonical flow
```
trigger → canonical orchestrator → dependency guard → step execution
  → output validation → QC → repair → resume → final_pdf_ready
```

## Ownership matrix
- Idempotency of every step (input hash + output asset ID).
- Resume from the last verified checkpoint, never from an earlier one.
- Bounded retries per class (see taxonomy below).
- DB-backed production lease (`production_locks`): owner + heartbeat + expiry; stale leases auto-expire and are re-acquired.
- Sequential-safe mode toggle (during active P0).
- Chained self-invoke ACK protocol (double-tap only when child has not acked within window).

## Hard forbids
- Retry that appends a duplicate page, row, or asset version.
- Two workers simultaneously repairing the same book row.
- Silent conversion of a missing dependency into a QC score of 0.
- Downgrading a `persistence_bug` to `content_quality_failure` to make the run "pass".

## Error taxonomy (every raised error MUST carry one class)
| Class | Recovery |
|---|---|
| `content_quality_failure` | Improve prompt / re-run producer with stronger constraints. Bounded to 3 attempts. |
| `dependency_missing` | Re-run the missing upstream step. Never score 0. |
| `temporary_provider_error` | Exponential backoff (30s → 2m → 8m). Cap 3. |
| `quota_wait` | Park run, schedule resume after quota window. |
| `persistence_bug` | Raise `needs_code_fix`, pause new production of this class. |
| `state_machine_bug` | Same as above. |
| `asset_access_bug` | Refresh signed URL or refetch bytes; treat as dependency_missing after 2 fails. |
| `non_recoverable_config` | Halt with actionable message; do not retire the book. |

## Interface every step MUST implement
```ts
type StepResult =
  | { status: "ok"; output_asset_ids: string[]; output_hashes: string[]; duration_ms: number }
  | { status: "error"; error_class: ErrorClass; error_code: string; message: string; recoverable: boolean };
```

## Deterministic scripts
- `scripts/check-orchestrator-invariants.sh` — fails if any edge function calls a state-mutating helper directly instead of the orchestrator entry.
- `scripts/find-retry-append-antipatterns.sh` — flags code that appends to a persisted list without an idempotency key.

## Stopping condition (per skill principle 1)
If two consecutive repair attempts produce the same output hash + same scores, stop retrying — raise `needs_code_fix` with evidence and pause new production of that class.
