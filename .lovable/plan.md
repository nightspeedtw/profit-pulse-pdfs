## Coloring Book Autopilot (Admin) — Plan

Add a one-click autopilot for kids coloring books alongside the existing picture-book autopilot at `/admin/kids`, respecting the P0 freeze (coloring generation stays queued behind the sequential-safe lock until P0 closes; the queue and scheduler run now, dispatch flips on automatically once the lock releases).

### 1. New admin card — `ColoringAutopilotCard`
Rendered on `/admin/kids` under the existing autopilot cards. Controls:
- **Topic mode**: `Random` (weighted pick from `coloring_categories`) or `Specific` (dropdown of categories loaded from `coloring_categories`).
- **Age band**: 3-5 / 4-6 / 6-8 (defaults 4-6).
- **Page count**: 24 / 32 / 48 (per existing page-plan presets).
- **Batch size**: how many books to queue in this click (1–20).
- **Daily cap**: max coloring books to auto-create per UTC day (0 disables auto-scheduling; manual clicks still work).
- **Daily stop time (UTC)**: HH:MM after which the scheduler stops queuing new coloring books for the day.
- **Enabled** switch (autopilot on/off, independent of the picture-book autopilot).
- **[Run now]** button — one click; queues `batch_size` coloring books immediately.

Live status strip: today's queued/in-progress/published counts, next scheduled tick, current lock holder.

### 2. Settings persistence
New row-scoped record in `generation_settings` (extend, don't fork) — add JSON column `coloring_autopilot` `{ enabled, topic_mode, specific_category_key, age_band, page_count, batch_size, daily_cap, daily_stop_utc }`. Read/written by the admin card via service-role edge function (`coloring-autopilot-config`), never from the client directly.

### 3. New edge function — `coloring-autopilot-tick`
- Invoked by the existing 5-min cron (`autopilot-tick` fans out) and by the "Run now" button.
- Reads `coloring_autopilot` config. Guards: enabled, before daily_stop_utc, under daily_cap, sequential-safe lock free, daily cost cap not tripped.
- For each slot up to batch_size:
  - If `topic_mode = random`: weighted pick from `coloring_categories` (reuse `list_active_categories` helper; weight by `sales_last_30d` fallback uniform).
  - If `specific`: use the selected category_key.
  - Generate a title via existing kids title helper (age-appropriate, category-aware) — deterministic fallback: `"{Category} Coloring Adventure"`.
  - Invoke `coloring-book-start` with `{ category_key, title, age_band, page_count }` (extend that function to accept `age_band` + `page_count`).
- All rows land in `ebooks_kids` with `pipeline_status = queued` and metadata `awaiting: p0_close_before_generation` (unchanged behavior — no gate/threshold changes, no P0 lane interference).

### 4. Wiring
- `coloring-book-start`: extend request body to accept optional `age_band` and `page_count`; falls back to current defaults.
- `autopilot-tick`: after its existing steps, invoke `coloring-autopilot-tick` (fire-and-forget) so the same 5-min heartbeat drives both lanes.
- Post-P0: when the sequential-safe lock releases, existing pipeline picks up queued coloring rows in FIFO order — no additional dispatcher work required for this ticket.

### 5. Non-goals (explicit)
- Does NOT change any QC threshold, gate, budget, or P0 fixture logic.
- Does NOT start coloring generation while P0 is active — rows queue only.
- Does NOT touch the picture-book autopilot config or runs.

### Files
- new: `src/components/admin/ColoringAutopilotCard.tsx`
- new: `supabase/functions/coloring-autopilot-tick/index.ts`
- new: `supabase/functions/coloring-autopilot-config/index.ts` (get/set settings)
- edit: `supabase/functions/coloring-book-start/index.ts` (accept age/pages)
- edit: `supabase/functions/autopilot-tick/index.ts` (fan-out call)
- edit: `src/pages/admin/KidsAutopilot.tsx` (mount card)
- migration: add `coloring_autopilot jsonb` column to `generation_settings` with sane defaults.

### Verification
- Playwright: open `/admin/kids`, screenshot the new card, click **Run now** with batch=2 random, confirm two new `ebooks_kids` rows with `book_type='coloring_book'` and `pipeline_status='queued'`.
- Confirm no P0 lane rows change state; sequential-safe lock unaffected.
