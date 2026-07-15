# Architecture Contract

## Single orchestrator

Different entry points may trigger work, but they must call one canonical orchestrator. UI buttons, batch jobs, watchdogs, schedulers, supervisors, and recovery workers must not implement their own pipeline logic.

## Canonical records

Use one canonical source for each concern:

- book content and product identity;
- run and state-machine status;
- step attempts and evidence;
- logical pages;
- versioned assets;
- QC findings;
- public product copy.

Do not maintain competing ebook/run models in active paths.

## State machine

A step may be `pending`, `running`, `passed`, `repairing`, `waiting_external`, `needs_code_fix`, `human_review_required`, or `failed_terminal`.

Rules:

- only the orchestrator changes the current step;
- a step passes only after persisted output reloads and validates;
- missing dependencies route to dependency repair;
- retries preserve valid upstream outputs;
- terminal failure cannot coexist with an active repair worker;
- resume begins at the first invalid required step.

## Idempotency

Logical pages use a uniqueness key:

`book_id + canonical_page_number + content_version`

Retries replace/upsert. They never append a second logical page. PDF assembly rejects duplicate page numbers, normalized text hashes, and image hashes.

## Asset contract

Canonical identity is asset ID + storage path + version + SHA-256 hash. Temporary signed URLs are transport only, never canonical identity.

Every consumer receives the exact asset ID/version produced by the previous step. Quality evaluators validate bytes, MIME type, size, page count, and hash before scoring.

## Error separation

Technical input failure returns a null quality score and a repairable technical code. It never becomes quality score 0.

Examples:

- inaccessible PDF ≠ bad PDF layout;
- missing manuscript ≠ weak manuscript;
- absent thumbnail ≠ low thumbnail aesthetics.

## Sequential-safe mode

Until stability proof passes:

- one heavy book run at a time;
- one image batch owner per book;
- one PDF render at a time;
- one recovery owner per failed step;
- leases/heartbeats prevent duplicate ownership.
