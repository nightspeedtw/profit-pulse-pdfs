## Fully Separate Coloring Book Autopilot — Plan

Right now `ebooks_kids` is a shared table for both `picture_book` and `coloring_book`, and the picture-book workers (`autopilot-kids-orchestrator`, `autopilot-kids-pipeline`, `kids-batch-producer`, `kids-repair-*`) never filter by `book_type`. That means a queued coloring row can be picked up by the picture-book engine — the two systems are not actually separated. This plan isolates them end-to-end.

### 1. Data separation (no schema break)
- Keep `ebooks_kids` as the shared table (already indexed, RLS'd, referenced by many tables).
- Introduce a hard filter contract: **every picture-book worker query adds `.neq('book_type', 'coloring_book')`**, and every coloring worker adds `.eq('book_type', 'coloring_book')`. This is the enforceable "separate queue" — same table, disjoint queues by `book_type`.
- Migration: add a partial index `ebooks_kids (pipeline_status) WHERE book_type = 'coloring_book'` for the coloring worker's queue scan.

### 2. Picture-book workers gain the exclusion filter
Audit + patch these to skip `book_type = 'coloring_book'`:
- `autopilot-kids-orchestrator/index.ts`
- `autopilot-kids-pipeline/index.ts`
- `kids-batch-producer/index.ts`
- `kids-repair-supervisor/index.ts`, `kids-repair-tick/index.ts`, `kids-autopilot-watchdog/index.ts`
- `kids-publish-if-qc-passed/index.ts`, `kids-recompute-weights/index.ts` (weight recompute must ignore coloring)

No behavior change for existing picture books; coloring rows become invisible to that lane.

### 3. Dedicated coloring engine
- New `coloring-worker-tick` edge function — the coloring-only dispatcher. Reads `pipeline_status='queued' AND book_type='coloring_book'`, respects `coloring_autopilot.paused`, its own concurrency cap (`max_parallel` in config, default 1), and its own daily cost budget slot (separate `daily_cost_cap_usd_coloring` field on the config JSON).
- The tick calls a placeholder `coloring-book-render` step function that (for now) transitions `queued → generating` and back to `queued` with a note "generation engine pending post-P0 build" — keeps the state machine visible without touching P0 code paths. Real render implementation is a follow-up when P0 closes.
- Cron: existing `autopilot-tick` already fans out to `coloring-autopilot-tick` (schedules new work); add a second fan-out to `coloring-worker-tick` (processes queue). Both are coloring-only and independent of `generation_settings.paused`.

### 4. Dedicated commands (admin card)
Add a command row to `ColoringAutopilotCard`:
- **Run now** (existing) — queues N books via `coloring-autopilot-tick`.
- **Process queue** — one-shot invoke of `coloring-worker-tick` (manual dispatch).
- **Pause engine** / **Resume engine** — toggles `coloring_autopilot.paused` (new field, independent of global `paused`).
- **Cancel all queued** — sets `pipeline_status='cancelled'` on `queued` coloring rows (admin-only, via edge function `coloring-cancel-queued`).
- Per-row **Cancel** button in the recent-rows list for granular control.

### 5. Dedicated status
Extend the status snapshot returned by `coloring-autopilot-config` (already returns `queued/created_today/published_today/recent`) with:
- `generating`, `cancelled`, `failed` counts (coloring-only)
- `paused` flag
- `last_worker_tick_at` + `last_worker_tick_result` (persisted on the config JSON by `coloring-worker-tick`)
- `spent_today_usd_coloring` from `cost_log` filtered by a `lane: 'coloring'` tag added on future cost writes

Render a second status strip in the card: **Engine: running/paused · Last tick: 2m ago · Spent today: $0.00 / cap**.

### 6. Migration
Add to `generation_settings.coloring_autopilot` JSON defaults:
```
{ ...existing, paused: false, max_parallel: 1, daily_cost_cap_usd_coloring: 5,
  last_worker_tick_at: null, last_worker_tick_result: null }
```
Add partial index on `ebooks_kids` for the coloring queue scan.

### 7. Non-goals
- Does NOT build the real coloring page-render pipeline (that unblocks post-P0). This plan wires the separated engine skeleton so the queue is provably isolated; the render step is a stub until P0 closes.
- Does NOT touch picture-book QC/gates/thresholds. Only adds `book_type` exclusions to their queries.
- Does NOT change the global `paused` flag semantics for picture books.

### Files
- new: `supabase/functions/coloring-worker-tick/index.ts`
- new: `supabase/functions/coloring-book-render/index.ts` (stub)
- new: `supabase/functions/coloring-cancel-queued/index.ts`
- edit: `supabase/functions/coloring-autopilot-config/index.ts` (extend status + accept `paused`/`max_parallel`/`daily_cost_cap_usd_coloring`)
- edit: `supabase/functions/coloring-autopilot-tick/index.ts` (respect `paused`)
- edit: `supabase/functions/autopilot-tick/index.ts` (fan-out to worker tick)
- edit: 6 picture-book workers (add `.neq('book_type','coloring_book')`)
- edit: `src/components/admin/ColoringAutopilotCard.tsx` (new commands + engine status strip)
- migration: partial index + extended defaults on `coloring_autopilot` JSON

### Verification
- Playwright: open `/admin/kids/autopilot`, verify Pause/Resume/Process/Cancel buttons work; queue coloring books and confirm they never appear in picture-book worker logs.
- Read-query: after Run now + Cancel all queued, coloring rows show `cancelled`; picture-book queue counts unchanged.
