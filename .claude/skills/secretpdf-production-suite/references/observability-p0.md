# Observability and P0 Response

## Objective

Make every run explain what it is doing, what it is waiting for, and why it failed.

## Structured event

Emit events with:

```json
{
  "correlation_id": "",
  "run_id": "",
  "book_id": "",
  "step_key": "",
  "subtask": "",
  "attempt": 1,
  "status": "",
  "input_asset_ids": [],
  "output_asset_ids": [],
  "input_hashes": [],
  "output_hashes": [],
  "provider": "",
  "model": "",
  "duration_ms": 0,
  "cost_usd": 0,
  "error_class": "",
  "error_code": "",
  "error_detail": "",
  "recovery_action": "",
  "next_retry_at": "",
  "created_at": ""
}
```

Do not truncate the only stored error to a generic message. Keep a public-safe summary and full diagnostic detail separately.

## Live status

Every active run exposes:

- title
- queue position
- current step and step number
- current subtask
- overall progress
- subtask progress
- elapsed time
- last heartbeat
- auto-fix attempt
- blocker and next retry

Use precise states:

- queued
- running
- repairing
- waiting_for_provider
- waiting_for_quota
- waiting_for_lock
- paused_p0
- needs_code_fix
- needs_admin
- final_pdf_ready

## Heartbeat

Long-running steps update at least every 30 seconds or after each subtask. A stale heartbeat triggers diagnosis, not an immediate duplicate worker.

Recovery must acquire the step lease before resuming.

## Repair fingerprint

Show:

- what failed
- what was changed
- whether output hash changed
- whether scores improved
- what strategy is next

If the same output and scores repeat, stop the loop and raise `needs_code_fix`.

## P0 dashboard

Display:

- active incident
- paused trigger count
- affected runs
- first occurrence
- most recent recurrence
- linked regression fixture
- code owner or repair task
- original fixture result
- fresh-book proof count
- resume criteria

## Archive diagnosed failures

Archiving hides noise; it must not delete evidence. Preserve:

- error payload
- run and step records
- artifact IDs and hashes
- diagnosis
- regression fixture reference
- repair commit

## Resume policy

Resume the batch only when declared exit criteria pass. Do not resume merely because the UI is quieter.
