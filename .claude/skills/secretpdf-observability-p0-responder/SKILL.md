---
name: secretpdf-observability-p0-responder
description: Use for SecretPDF pipeline observability and P0 incident response — structured per-run logs (run_id, book_id, step, attempt, input/output asset IDs + hashes, provider, duration_ms, error_class, error_code, recovery_action, next_retry_at), correlation IDs, step durations, provider usage, retry fingerprints, stale-heartbeat detection, recurring-regression classification, and the pause-preserve-fix-prove-resume loop when a class returns. NEVER truncate error messages to generic strings. Distinct from qc-contract-auditor (gate contracts) and pipeline-orchestrator (state machine).
---

# SecretPDF Observability + P0 Responder

Every step emits one structured record. Errors carry full context. Recurring
regressions trigger a mandatory pause-and-prove loop.

## Log record schema (append to `pipeline_step_logs`)
```json
{
  "run_id": "uuid",
  "book_id": "uuid",
  "step": "kids-build-picture-pdf",
  "attempt": 1,
  "input_asset_ids": ["cover@sha256:...", "interior[3]@sha256:..."],
  "input_hashes": {"cover": "sha256:...", "manuscript": "sha256:..."},
  "output_asset_ids": ["pdf@sha256:..."],
  "output_hashes": {"pdf": "sha256:..."},
  "provider": "fal.ai / gemini-2.5-flash / pdf-lib@1.17.1",
  "duration_ms": 12345,
  "error_class": null,
  "error_code": null,
  "message": "ok",
  "recovery_action": null,
  "next_retry_at": null,
  "correlation_id": "batch-2026-07-15-14:30-chef-pip"
}
```

## Rules
- **Never truncate errors.** Store the raw stack + provider payload. Any UI
  summary must link back to the full record.
- **Correlation ID** groups all steps of one run + all repair attempts on the
  same book.
- **Stale heartbeat detector**: any step whose `updated_at` is older than
  `step_timeout_seconds` without a completion record → surfaced as
  `stale_run`, orchestrator recovers.
- **Retry fingerprint** = hash(step, book_id, input_hashes, error_code).
  If the same fingerprint recurs 3× within 24h → classify as
  `recurring_regression`, auto-pause new production of that class.

## P0 loop (when a recurring regression is detected)
1. **Pause** new book generation for the affected class. Existing in-flight
   books finish or checkpoint.
2. **Preserve** evidence — do not delete failed records, do not overwrite
   assets. Copy artifacts under `artifacts/incident-<id>/`.
3. **Run the regression fixture** (via regression-eval-harness) to prove
   the reproduction.
4. **Fix the class** (per orchestrator + qc-contract-auditor + pdf-integrity
   guidance). Add a permanent fixture.
5. **Prove** on the fixture + one fresh book of the affected class.
6. **Resume** production only after the manifest validator exits 0.

## Deterministic script
- `scripts/detect-recurring-regression.sh` — reads `pipeline_step_logs` for
  the last 24h, groups by retry fingerprint, prints classes exceeding the
  threshold. Exits 1 if any recurring regression is active.
