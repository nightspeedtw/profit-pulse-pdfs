# Architecture and Orchestrator Contract

## Objective

Make every trigger call one canonical orchestration brain. Triggers may differ; business logic must not.

## Audit before editing

Map all entry points:

- admin buttons
- one-click build
- batch producer
- scheduler
- watchdog
- recovery worker
- supervisor
- retry endpoint
- resume endpoint
- direct function invocation

For each entry point, record:

```json
{
  "entry_point": "",
  "file": "",
  "function": "",
  "book_table": "",
  "run_table": "",
  "state_machine": "",
  "failure_policy": "",
  "worker_called": ""
}
```

A trigger may create a run or enqueue work. It must not own a private state machine, retry policy, QC policy, or publishing decision.

## Canonical orchestration contract

The canonical orchestrator must own:

1. preflight
2. run creation
3. dependency validation
4. state transition
5. step execution
6. output validation
7. QC dispatch
8. repair dispatch
9. retry scheduling
10. resume selection
11. final status

All other callers must pass a typed command:

```ts
type PipelineCommand = {
  command: "start" | "resume" | "retry_step" | "repair_dependency" | "cancel";
  bookId: string;
  runId?: string;
  requestedBy: string;
  correlationId: string;
};
```

## One canonical state machine

For Phase 1 PDF-only:

```text
start_run
preflight_check
generate_book_brief
generate_title
title_qc
generate_outline
outline_qc
write_content
content_qc
build_manuscript
reader_experience_qc
cover_strategy
cover_generation
cover_qc
thumbnail_generation
thumbnail_qc
pdf_layout_generation
pdf_rendering
pdf_screenshot_qc
pdf_qc
final_pdf_ready
final_report
```

Illustrated books insert the Story Bible, Character Bible, Style Bible, page plan, and illustration stages described in `illustrated-continuity.md`.

Each step stores:

```json
{
  "step_key": "",
  "status": "pending|running|passed|passed_existing|repairing|waiting|failed|needs_code_fix|needs_admin",
  "attempt": 0,
  "input_asset_ids": [],
  "output_asset_ids": [],
  "input_hashes": [],
  "output_hashes": [],
  "started_at": "",
  "heartbeat_at": "",
  "completed_at": "",
  "error_class": "",
  "error_code": "",
  "repair_action": ""
}
```

## Canonical data model

Select one source of truth for each entity:

- book
- run
- run step
- logical page
- asset
- QC report
- final PDF pointer
- verified product metadata
- public sales copy

Do not allow old and new tables to drive different workers. If migration is required:

1. designate canonical tables
2. write compatibility readers temporarily
3. route all new writes to canonical tables
4. backfill
5. verify counts and hashes
6. quarantine legacy writes
7. remove compatibility readers after proof

## Idempotency

Use stable logical keys:

```text
book_id + stage + logical_item_id + content_version
```

For pages:

```text
book_id + canonical_page_number + content_version
```

A retry replaces or versions the same logical item. It never appends a second logical page.

Use database uniqueness constraints where possible. Treat uniqueness violations as evidence of an orchestration bug, not as a reason to silently ignore data.

## Dependency policy

Before each step, validate required outputs. If a dependency is missing:

- classify `missing_dependency`
- route to the producer step
- do not count this as a quality repair attempt
- return to the original step after persistence and validation

Examples:

- no outline → generate outline
- missing pages → generate only missing pages
- missing manuscript → assemble from canonical pages
- missing cover → generate cover
- expired PDF URL → resolve canonical asset; do not rerender content

## Failure policy

Declare a policy for every step:

- `repair`: targeted repair exists
- `retry`: transient provider or network failure
- `wait`: quota or concurrency slot
- `rotate_concept`: story concept is fundamentally unworkable
- `needs_code_fix`: contract, state, persistence, asset, or idempotency bug
- `needs_admin`: credentials or nonrecoverable decision

Do not retire a book because a temporary provider call or database write failed.

## Sequential-safe mode

Until reliability proof passes:

```text
heavy_production_concurrency = 1
pdf_render_concurrency = 1
thumbnail_generation_concurrency = 1
```

Topic ideation may run in parallel. Heavy work must acquire a lease with expiration and heartbeat. A second worker must not execute the same run step while the lease is valid.

## Cleanup and feature flags

Quarantine unrelated phases:

```ts
export const FEATURES = {
  PHASE_1_PDF_ONLY: true,
  SHOPIFY_UPLOAD: false,
  SEO_AUTOMATION: false,
  BLOG_AUTOMATION: false,
  ROYALTY_MARKET: false,
  PAYMENTS: false,
  PUBLIC_PUBLISHING: false
};
```

Audit before deletion. Remove or archive:

- duplicate orchestrators
- duplicate Fix All implementations
- unused Supabase functions
- deprecated table readers
- stale UI controls
- old publishing paths
- unused dependencies

## Architecture acceptance

Pass only when:

- every trigger reaches the same orchestrator
- one state machine determines transitions
- one data model drives workers and dashboards
- retries are idempotent
- only one heavy job runs
- disabled phases cannot block PDF completion
- an interrupted run resumes from the first incomplete step
