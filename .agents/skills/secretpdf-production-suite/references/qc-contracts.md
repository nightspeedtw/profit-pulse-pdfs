# QC Producer, Persistence, and Gate Contracts

## Objective

Eliminate `n/a` gates, stale scores, contradictory pass/fail logic, and endless automatic repairs.

## Contract map

For every gate, document:

```json
{
  "gate": "reader",
  "producer": "reader-experience-qc",
  "required_inputs": [],
  "output_schema": {},
  "persist_table": "",
  "persist_field": "",
  "gate_read_paths": [],
  "thresholds": {},
  "missing_data_policy": "",
  "repair_function": "",
  "max_meaningful_attempts": 3
}
```

Trace this exact chain:

```text
producer output
→ database persistence
→ record reload
→ gate field path
→ pass/fail calculation
→ pipeline state
```

A producer response that is not persisted is not a successful repair.

## Missing data is not a quality failure

Use these states:

- `missing_dependency`
- `producer_not_run`
- `producer_persist_failed`
- `gate_mapping_mismatch`
- `quality_failed`

Do not assign a numeric quality score when the evaluator lacks the artifact.

Examples:

- no manuscript → `missing_dependency`, score `null`
- PDF inaccessible → `asset_access_error`, score `null`
- thumbnail absent → `producer_not_run`, score `null`
- all fields persisted but gate reads `n/a` → `gate_mapping_mismatch`

## Complete output schemas

Every producer returns all required fields with numeric values or a typed technical error. Never return partial silently.

Example reader contract:

```json
{
  "schema_version": "reader-qc-v1",
  "overall_score": 92,
  "natural_language": 94,
  "human_feel": 93,
  "emotional_resonance": 88,
  "page_turning": 88,
  "sellability": 91,
  "clarity": 94,
  "variety": 92,
  "no_ai_patterns": 95,
  "no_repetition": 94,
  "voice_consistency": 93,
  "trust": 90,
  "passed": true,
  "findings": [],
  "artifact_version": 4,
  "artifact_hash": ""
}
```

Example cover-thumbnail contract:

```json
{
  "schema_version": "cover-thumb-qc-v1",
  "overall_score": 93,
  "book_mockup": 95,
  "readability": 94,
  "click_appeal": 92,
  "premium_feel": 93,
  "category_match": 96,
  "anti_ai_look": 91,
  "asset_id": "",
  "asset_version": 2,
  "asset_hash": "",
  "passed": true
}
```

## Explicit threshold semantics

Do not mix an overall threshold with undocumented subscore thresholds.

Define gates as code-visible policy, for example:

```json
{
  "overall_min": 90,
  "hard_subscores": {
    "natural_language": 90,
    "human_feel": 90,
    "clarity": 90,
    "no_ai_patterns": 90,
    "no_repetition": 90,
    "voice_consistency": 90,
    "sellability": 90
  },
  "soft_subscores": {
    "emotional_resonance": 85,
    "page_turning": 85,
    "trust": 85
  }
}
```

The producer and repair prompt must target the actual policy.

## Repair fingerprint

Persist each repair attempt:

```json
{
  "gate": "",
  "attempt": 1,
  "failing_fields": [],
  "before_scores": {},
  "repair_strategy": "",
  "input_hash": "",
  "output_hash": "",
  "after_scores": {},
  "persisted": true,
  "verified_by_gate": true
}
```

Stop repeating when:

- the output hash is unchanged
- the failing fields are unchanged
- the same strategy has been used twice without improvement
- persistence succeeded but the gate still reads missing data

Then classify `needs_code_fix` and identify the producer, field, and gate path.

## Targeted repair map

Repair the weakest measured dimension only.

- low page turning → openings, transitions, curiosity, section endings
- low repetition score → repeated phrasing and structures
- low human feel → robotic syntax, over-explanation, generic filler
- low trust → overclaims, unsupported certainty, vague statistics
- low cover readability → typography layer, contrast, safe area
- low character consistency → regenerate affected pages from canonical reference
- low PDF layout → repair the affected layout component and rerender

Do not rewrite the entire book when a bounded section repair is sufficient.

## Recompute correctly

After producer persistence:

1. commit the transaction
2. reload the canonical book/run record
3. resolve the exact artifact version
4. run the gate computation
5. persist the gate result
6. transition only if the gate reads the new data

Do not reuse an in-memory stale record.

## QC acceptance

Pass when:

- every required producer has a versioned output
- every required field is numeric
- persisted fields equal gate-read fields
- no gate is `n/a`
- missing dependencies do not consume quality attempts
- repairs stop when no improvement occurs
- thresholds are unchanged
