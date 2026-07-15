---
name: secretpdf-qc-contract-auditor
description: Use when auditing, adding, or debugging any SecretPDF quality gate — verifying that each gate is a real CONTRACT (producer → persistence field → gate reader → threshold → missing-data policy → repair function), detecting n/a gates caused by field mismatches, distinguishing missing-data from failed-quality-attempt, catching same-score repair loops, and refusing gate bypasses or threshold reductions. Does NOT own the state machine (pipeline-orchestrator) or PDF byte inspection (pdf-integrity-engineer).
---

# SecretPDF QC Contract Auditor

Every gate is a written contract, not a prompt. If the producer wrote the field but the gate reads `n/a`, that is a code bug — never a quality failure.

## Contract schema (per gate)
```yaml
gate: story_judge
producer: supabase/functions/kids-story-judge/index.ts
required_fields: [manuscript_md, story_bible_json.character.name]
persist_target: ebooks_kids.qc_scorecard.story_judge
gate_read_paths: [qc_scorecard.story_judge.dimensions.*.score]
thresholds: {each_dimension_min: 85}
missing_data_policy: raise dependency_missing (NOT score 0)
repair_function: kids-repair-story-gate
```

Minimum audited gates: title, story judge, reader experience, character consistency, cover, cover thumbnail, PDF preflight, formatting, sales-page metadata.

## Rules
- **Missing data ≠ failed quality attempt.** If required fields are absent, raise `dependency_missing`; the orchestrator re-runs the producer.
- **Producer saved data but gate reads n/a = persistence_bug.** Fix the field path — do not lower the threshold.
- **Same scores twice = stop.** Two repair attempts producing identical scores → `needs_code_fix`, pause the class, produce evidence.
- **Never modify a QC row to make it pass.**
- **Never lower a threshold to unblock a book.**
- **Never mark a critical rule non-critical.** See `supabase/functions/_shared/qc/critical.ts`.

## Deterministic scripts
- `scripts/build-qc-contract-map.sh` — inventory every gate name and read path from the repo; writes `artifacts/qc/contract-map.md`.
- `scripts/detect-na-gates.sh` — grep `qc_scorecard.*n/a` / null-coalesce-to-zero patterns.
- `scripts/compare-producer-and-gate-fields.sh` — for each gate, list the write path from producer + read path from gate; mismatch = report.
- `scripts/validate-qc-persistence.sh` — verify every gate call reloads the persisted record before scoring (no in-memory shortcuts).

Run all four before merging any QC-related change.
