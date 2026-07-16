
# Coloring Book Autopilot — Visibility, Progress %, Unique Topics

## What the user is seeing today (root cause)

1. **"Run now" ดูเหมือนไม่มีอะไรเกิดขึ้น"** — `coloring-book-start` inserts an `ebooks_kids` row in `pipeline_status='queued'`, but `coloring-book-render` is a **stub** (frozen behind P0). It flips `queued → generating → queued` with `awaiting: "post_p0_coloring_render_engine"` and returns. Nothing visible actually renders.
2. **No % progress / no "what is the system doing"** — the status strip only shows counts (queued / generating / cancelled). There is no per-book progress bar, no current-step label, no last-action reason.
3. **Duplicate titles** — `titleFor(cat, ageBand)` picks from 5 openers × category name × age band only (e.g. "Dinosaurs Coloring Adventures (Ages 4–6)"). Same category = high collision. No angle, no subtitle, no uniqueness check.

## Proposed changes (frontend + status only — no P0 code touched)

### 1. Unique topics per category (angle system)

- Add an **angle library** per category in `supabase/functions/_shared/coloring/angles.ts`:
  - Generic angles: `Cute`, `Fierce`, `Baby`, `Giant`, `Magical`, `Underwater`, `Space`, `Winter`, `Party`, `Jungle`, `Rainbow`, `Superhero`.
  - Category-scoped overrides (e.g. dinosaurs → `Cute Dinosaurs`, `Fierce Dinosaurs`, `Baby Dinos`, `Dinos in Space`; vehicles → `Race Cars`, `Monster Trucks`, `Fire & Rescue`).
- `titleFor(cat, ageBand, angle)` produces English titles like:
  - `Cute Dinosaurs Coloring Book — 32 Fun Pages (Ages 4–6)`
  - `Fierce Dinosaurs Coloring Adventures (Ages 4–6)`
- **Duplicate guard** in `coloring-autopilot-tick`: before inserting, query `ebooks_kids` for `book_type='coloring_book'` in the same category and pick the first unused angle. If all angles used, append `V2`, `V3`, … suffix. Never insert two rows with identical `title`.
- Persist chosen `angle` + `variant_number` into `metadata.coloring_angle` / `metadata.coloring_variant` for downstream diversity.

### 2. Live progress % + current-step label

- Extend `ebooks_kids.metadata` with two observability fields (no schema change; JSON keys):
  - `coloring_progress_percent` (0–100)
  - `coloring_current_step_label` (e.g. "Planned 32 pages", "Awaiting P0 close — render engine paused", "Cancelled by admin")
- `coloring-book-start` seeds `{ progress: 5, label: "Queued — waiting for engine" }`.
- `coloring-book-render` (stub) truthfully sets `{ progress: 10, label: "Awaiting post-P0 coloring render engine" }` — no fake progression.
- `coloring-cancel-queued` sets `{ progress: 0, label: "Cancelled by admin" }`.
- When the real render engine ships post-P0, each of its steps writes its own `%` + label (plan → cover → interior batch → PDF assemble → done).

### 3. Status panel upgrade (`ColoringAutopilotCard`)

- Add a **"Engine status" banner** at the top of the status strip that reads the truth from config:
  - `Engine paused` (amber) if `cfg.paused`
  - `Awaiting P0 — render blocked` (amber) if the stub is still active (detected via the most recent `awaiting` metadata flag)
  - `Running` (emerald) otherwise
- Add **per-row progress row** in the "recent" list:
  - Title · angle badge · progress bar (`<div class="h-1 bg-…">`) · % · current step label · cancel button (if queued/generating)
- Extend `coloring-autopilot-config` snapshot to return, for each recent row: `progress_percent`, `current_step_label`, `angle`, `variant_number`, `awaiting`. Poll every 10s (down from 15s) while any row is `generating`.
- Add a **"Last action" line** under the tick timestamp: renders the last dispatched or cancelled event with its label.

### 4. Real coloring render engine (out of scope for this task)

Not touched here. The stub is P0-frozen. Once P0 closes we'll wire the real page/cover/PDF pipeline into `coloring-book-render` and it will drive the same `progress_percent` / `current_step_label` fields — the UI ships now and lights up automatically when the engine comes online.

## Files touched

- **New**: `supabase/functions/_shared/coloring/angles.ts`
- **Edit**: `supabase/functions/coloring-autopilot-tick/index.ts` — angle+dup guard, title composer
- **Edit**: `supabase/functions/coloring-book-start/index.ts` — accept `angle`, seed progress metadata
- **Edit**: `supabase/functions/coloring-book-render/index.ts` — honest progress label
- **Edit**: `supabase/functions/coloring-cancel-queued/index.ts` — cancel label
- **Edit**: `supabase/functions/coloring-autopilot-config/index.ts` — return angle + progress in `status.recent`
- **Edit**: `src/components/admin/ColoringAutopilotCard.tsx` — engine banner, per-row progress bar, current-step label, angle badge, 10s poll while generating

## Verification

- Run "Run now" three times on same category → three rows with distinct English angles (`Cute … / Fierce … / Baby …`), no title duplicates.
- Recent list shows each row with a progress bar (currently pinned at 10% "Awaiting post-P0 …") and a clear engine banner explaining why no generation is happening yet — solving the "ไม่เห็นอะไรเกิดขึ้น" confusion truthfully instead of faking work.

## Explicit non-goals

- Does **not** unfreeze P0.
- Does **not** build the real coloring render engine.
- Does **not** fabricate progress %; the stub reports its real state (10% / awaiting).
- Does **not** touch picture-book workers, QC gates, or thresholds.
