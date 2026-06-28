# Live Autopilot Run Tracking

Make every Autopilot run transparent: the admin always sees the current step, action, QC score, auto-fix attempts, and the real blocker when something stops.

---

## 1. Database (migration)

### `autopilot_runs` (new — current `autopilot_runs` is per-step log; rename old → `autopilot_runs_legacy` to preserve history)

```
id uuid pk
ebook_id uuid null
idea_id uuid null
status text         -- starting|running|auto_fixing|needs_admin|completed|failed|paused
current_step text   -- machine name, e.g. "render_pdf"
current_step_label text
current_action_message text
progress_percent int default 0
started_at timestamptz default now()
updated_at timestamptz default now()
completed_at timestamptz
failed_at timestamptz
admin_needed_reason text
error_message text
summary_json jsonb default '{}'  -- final report payload
triggered_by uuid (auth.users)
test_mode bool default false
```

### `autopilot_run_steps` (new)

```
id uuid pk
run_id uuid → autopilot_runs(id) on delete cascade
ebook_id uuid null
step_order int
step_name text
step_label text
status text           -- pending|running|passed|auto_fixing|failed|skipped|needs_admin
message text
score numeric
required_score numeric
auto_fix_attempts int default 0
max_auto_fix_attempts int default 3
started_at timestamptz
completed_at timestamptz
duration_ms int
error_message text
metadata_json jsonb default '{}'
created_at timestamptz default now()
```

GRANTs: `authenticated` SELECT (admins read), `service_role` ALL. RLS: admin-only via `has_role`. Realtime: add both tables to `supabase_realtime`.

Seed the 21-step template in code (constant), not a table.

---

## 2. Pipeline instrumentation (`supabase/functions/_shared/run-tracker.ts` new)

Shared helper used by `autopilot-pipeline` and every step function it calls:

```ts
startRun(opts) → run_id
startStep(run_id, step_name, label, message)
updateStep(run_id, step_name, patch)   // message, score, auto_fix_attempts
passStep(run_id, step_name, score?)
failStep(run_id, step_name, error)
markAutoFixing(run_id, step_name, attempt, max, reason)
needsAdmin(run_id, step_name, reason, recommended_action)
completeRun(run_id, summary)
```

Each call also updates the parent `autopilot_runs` row's `current_step`, `current_action_message`, `progress_percent` (= passed_steps / total_steps * 100), and `updated_at = now()`.

### Wire into `autopilot-pipeline/index.ts`

Insert tracker calls around the existing chain:

```
start_run → generate_idea → idea_qc → outline → outline_qc
→ chapters → chapter_qc → manuscript_qc → cover → cover_qc
→ thumbnail → thumbnail_qc → pdf_layout → pdf_render → pdf_qc
→ product_copy → product_qc → shopify_draft → shopify_verify → complete
```

For QC gates wrapped by `runWithAutoFix`, call `markAutoFixing(attempt, 3, reason)` inside its retry callback so the live panel reflects each attempt. On terminal failure: `needsAdmin(reason)` and set run `status='needs_admin'`.

---

## 3. UI

### Command Center (`src/pages/admin/Dashboard.tsx`)

New `<LiveAutopilotCard />` at the top, visible whenever there is an `autopilot_runs` row with `status in ('starting','running','auto_fixing')`:

```
Autopilot Running
Current step: Rendering PDF
Action: Generating premium PDF layout and checking page breaks...
[==========65%==========]
Last updated: 12s ago     [View Run Details] [Pause After Step]
```

Subscribes to `autopilot_runs` realtime; falls back to 4s polling.

`Run Full Autopilot` button now navigates to `/admin/autopilot/run/:runId` after invoking the function.

### Run Details Page (`src/pages/admin/AutopilotRun.tsx` new, route `/admin/autopilot/run/:runId`)

Top: summary header (status pill, progress bar, started/elapsed, ebook title + thumbnail when available).

If `status='needs_admin'`: render existing `<AdminNeededPanel>` at top with the failing step, score vs required, attempts used, last error, recommended action, buttons (Retry Auto-Fix Once / Edit / Regenerate / Reject).

Body: vertical timeline of all 21 steps from `autopilot_run_steps` (ordered by `step_order`):

- pending = gray dot
- running = blue pulsing dot, animated message
- passed = green check + duration + score
- auto_fixing = orange spinner + "Auto-fixing [gate] — attempt N/3" + reason + action
- failed / needs_admin = red, with error text

Subscribes to both `autopilot_runs` and `autopilot_run_steps` realtime channels filtered by `run_id`.

Footer when `status='completed'`: final report card (title, Shopify draft URL, PDF URL, cover URL, thumbnail score, final premium score, total cost from `cost_log` join, total duration, auto-fix attempts used, failed gates list).

### New components

- `src/components/admin/LiveAutopilotCard.tsx`
- `src/components/admin/RunStepTimeline.tsx`
- `src/components/admin/RunFinalReport.tsx`

---

## 4. Status labels (single source of truth)

`src/lib/autopilot-steps.ts` — exported array of `{name, label, order}` for all 21 steps so UI and tracker stay in sync.

User-facing status labels per the spec ("Generating Idea", "Writing Chapters", "Auto-Fixing PDF", "Uploading Shopify Draft", "Needs Admin Attention", etc.) live in this file as a map from `(step_name, status)` → label.

---

## 5. Pause After Current Step

Add `pause_requested boolean default false` to `autopilot_runs`. The pipeline checks it between steps; when true, sets `status='paused'` and exits cleanly. Resume = call `autopilot-pipeline` with `resume_run_id`.

---

## Files touched

- `supabase/migrations/<ts>_autopilot_run_tracking.sql` (new)
- `supabase/functions/_shared/run-tracker.ts` (new)
- `supabase/functions/autopilot-pipeline/index.ts` (instrument every step + auto-fix callback)
- `supabase/functions/_shared/autofix.ts` (accept optional `onAttempt` callback for tracker updates)
- `src/lib/autopilot-steps.ts` (new)
- `src/components/admin/LiveAutopilotCard.tsx` (new)
- `src/components/admin/RunStepTimeline.tsx` (new)
- `src/components/admin/RunFinalReport.tsx` (new)
- `src/pages/admin/AutopilotRun.tsx` (new) + route in `App.tsx`
- `src/pages/admin/Dashboard.tsx` (mount LiveAutopilotCard, redirect after Run Full Autopilot)

---

## Out of scope

- No changes to QC scoring formulas, PDF generation, Shopify product schema, or auto-fix logic itself (only adds observability hooks).
- Existing per-step `autopilot_runs` table (now used as event log) is renamed to `autopilot_runs_legacy` and kept read-only; no data migration.

Approve to proceed?
