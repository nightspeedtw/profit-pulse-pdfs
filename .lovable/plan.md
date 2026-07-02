# Production Queue Visibility & Self-Debugging Autopilot

Delivers a single source of truth for what every ebook is doing, why, and — when a structural bug is detected — an auto-generated Lovable fix instruction the admin can copy in one click.

## 1. Canonical status model (backend)

Migration adds a `canonical_status` enum and columns used by every surface:

- `ebooks.canonical_status` (enum, indexed)
- `ebooks.queue_position` (int, null unless queued)
- `ebooks.queued_at`, `ebooks.estimated_start_after_run_id`
- `ebooks.waiting_reason` (text)
- `ebooks.current_step`, `ebooks.current_subtask`, `ebooks.progress_pct`, `ebooks.last_heartbeat_at`, `ebooks.current_qc_score`, `ebooks.autofix_attempt`, `ebooks.autofix_max`
- `ebooks.structured_error jsonb` (schema in §4)
- New table `system_fix_instructions` — one row per detected structural bug, holds the auto-generated Lovable fix prompt.

Allowed statuses (single vocabulary used everywhere):
`idea_generated`, `queued_for_production`, `production_running`, `generating_outline`, `writing_chapters`, `building_manuscript`, `running_qc`, `auto_fixing`, `generating_cover`, `generating_thumbnail`, `rendering_pdf`, `waiting_for_browserless_slot`, `waiting_for_shopify_quota`, `waiting_for_ai_budget`, `waiting_for_worker_slot`, `uploading_shopify_draft`, `verifying_shopify_draft`, `draft_uploaded`, `completed`, `needs_admin_attention`, `needs_code_fix`, `failed_non_recoverable`.

Vague statuses (`failed`, `pending`, `processing`, `review needed`) are banned in code and mapped forward in a one-shot backfill.

## 2. Sequential Safe Mode enforcement

Heavy statuses (outline → shopify verify) may only be held by the current lock holder of `heavy_production`. `autopilot-pipeline` calls `try_acquire_lock('heavy_production', ebook_id)` before entering any heavy step; on failure it sets `queued_for_production`, assigns `queue_position` (dense rank over `queued_at`), and writes `waiting_reason = "Waiting for current ebook to finish"`. `autopilot-recovery-worker` picks the lowest `queue_position` when the lock releases and dispatches it.

## 3. Structured error classifier

New `supabase/functions/_shared/error-classifier.ts` converts every thrown error into:

```
{ error_type, severity, recoverable, affected_step, user_friendly_message,
  technical_message, detected_root_cause, auto_recovery_action, next_retry_at,
  needs_code_fix, lovable_fix_instruction, affected_files, test_to_confirm }
```

Error types: `qc_repairable`, `dependency_repairable`, `temporary_api_error`, `quota_wait`, `config_error`, `data_binding_bug`, `state_machine_bug`, `concurrency_bug`, `renderer_bug`, `shopify_bug`, `pdf_quality_bug`, `status_visibility_bug`, `non_recoverable`.

Classifier owns known signatures (Browserless 429, Shopify 402/quota, missing outline JSON, chapter count < 8, worksheet overflow, empty Production query while runs exist, heartbeat stale > 5min, duplicate lock holders). Auto-recoverable types run the recovery action; structural bugs write to `system_fix_instructions` and set `canonical_status = needs_code_fix`. Admin is asked ONLY for the whitelisted cases (invalid Shopify token, missing API key, compliance block, 3 failed auto-fix attempts, non-recoverable runtime).

## 4. Autopilot Doctor

`supabase/functions/autopilot-doctor/index.ts`:

- Checks: stale heartbeats, duplicate `production_running`, lock/held-status mismatch, runs without steps, steps without runs, `failed` ebooks that are actually quota waits, jobs missing from Production query, chapter/outline dependency violations, Browserless concurrency > 1, Shopify quota mis-classified as QC failure.
- Emits a health score (0–100), auto-fixes what it can (release stale lock, re-classify statuses, requeue), writes remaining issues to `system_fix_instructions`.
- Scheduled every 5 min via `pg_cron`, also runs on every step failure, and callable from Advanced Mode.

## 5. Frontend — Live Production Queue

New `src/components/admin/LiveProductionQueue.tsx` mounted on Command Center and Production page, with five sections driven by `canonical_status`:

- **A. Currently Working On** — the lock holder, with title, run id, step X/23, current subtask, progress %, elapsed, last heartbeat, QC score, autofix attempt, Preview/Detail buttons.
- **B. Queued Next** — ordered by `queue_position`, shows waiting reason and "starts after {current title}".
- **C. Waiting / Paused Automatically** — Browserless / Shopify / AI budget / worker waits with `next_retry_at` countdown and auto-resume badge.
- **D. Auto-Fixing** — status `auto_fixing`, shows `autofix_attempt / autofix_max` and the specific repair action.
- **E. Needs Code Fix / System Repair** — reads `system_fix_instructions`, one card per bug with title, detected problem, root cause, affected files, required fix, acceptance test, and **Copy Lovable Fix Prompt** button.

Polls every 3s while any active/queued job exists, otherwise every 15s. Uses `admin-data` edge function so passcode auth continues to work.

## 6. Copy per §12 & timeline

`StatusBadge` and detail page consume `canonical_status` and produce the exact copy from the spec ("Now producing…", "Queued #3 — waiting for production slot", "Waiting for Browserless Slot — retrying automatically in 5 minutes", "Auto-fixing PDF worksheet overflow — attempt 2/3", "System code fix required — Lovable instruction generated"). Ebook detail page gets a vertical timeline: Created → Queued → Started → step trail with autofix attempts, waiting windows, retry schedule, Shopify status, terminal state.

## 7. Wiring existing pipeline

- `autopilot-pipeline` writes `canonical_status`, `current_step`, `current_subtask`, `progress_pct`, heartbeat on every tick; wraps every step in `classifyError()`.
- `write-chapters`, `generate-outline`, `final-manuscript-qc`, `render-pdf`, `generate-cover`, `shopify-*` all funnel errors through the classifier instead of returning bare strings.
- `autopilot-recovery-worker` dispatches from the queue on lock release and honours `next_retry_at`.

## Files affected (technical)

- Migrations: canonical status enum + columns on `ebooks`, `system_fix_instructions` table (+ GRANTs + RLS + updated_at trigger), backfill.
- Edge functions: `_shared/error-classifier.ts` (new), `autopilot-doctor/index.ts` (new), `autopilot-pipeline`, `autopilot-recovery-worker`, `render-pdf`, `write-chapters`, `generate-outline`, `final-manuscript-qc`, `generate-cover`, `shopify-upload`, `admin-data` (expose queue + fix instructions).
- Frontend: `LiveProductionQueue.tsx` (new), `SystemFixCard.tsx` (new), `AutopilotStatusCenter.tsx`, `Production.tsx`, `StatusBadge.tsx`, `src/lib/adminData.ts`, ebook detail timeline component.
- Cron: doctor every 5 min, existing recovery worker every 5 min.

## Acceptance tests

1. Start two Autopilot runs back-to-back → exactly one is `production_running`, the second is `queued_for_production` with `queue_position = 1` and visible in section B.
2. Kill Browserless (simulate 429) → run flips to `waiting_for_browserless_slot`, appears in section C with countdown, resumes without admin action.
3. Force outline JSON invalid 3× → auto-fix attempts visible in section D, then falls back to deterministic outline, run continues.
4. Point Production page at a fake empty query → Doctor detects `data_binding_bug`, section E shows a Lovable fix prompt including `src/pages/Production.tsx` and `src/lib/adminData.ts`.
5. Shopify daily cap → status `waiting_for_shopify_quota`, upload resumes at next reset window; never surfaced as `failed`.
6. Stale heartbeat > 5 min → Doctor releases the lock and requeues; next queued ebook starts within one poll cycle.
