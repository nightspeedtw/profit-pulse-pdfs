
# Fiction Autopilot Self-Healing Push To Live

## Goal

Turn the many existing one-shot repair endpoints into an autonomous supervisor that:
1. detects the latest blocker on a kids-book run,
2. dispatches to the correct existing repair handler,
3. re-runs the pipeline from a safe stage,
4. loops with bounded attempts,
5. either publishes on strict measured QC or honestly shelves.

Then use it to push one fresh kids book to live without touching any thresholds.

## What already exists (reused, not rewritten)

- `kids-concept-preflight` — 1+2 bounded concept judge (built last turn).
- `kids-fresh-book-start` — async ebook+run seeder that invokes preflight then pipeline.
- `autopilot-kids-pipeline` — canonical pipeline. Already has `metadata_gate` auto-sync and `bible_check` auto-wipe. Skips `generate_idea`/`generate_manuscript` when title/manuscript already exist.
- `kids-surgical-story-repair` — bounded single-attempt targeted refrain/callback rewrite.
- `kids-repair-story-gate` — up to 3 general story rewrites.
- `kids-global-style-fallback` — swaps style to `watercolor_soft`, regenerates cover+interiors.
- `kids-repair-cover` — cover rerender.
- `kids-final-text-repair` — glyph/typography fix on manuscript before PDF.
- `kids-build-picture-pdf` + `kids-publish-if-qc-passed` — multi-stage PDF → QC → publish.
- `kids-qc-run` — measured QC scorecard.

All thresholds live inside these functions and stay untouched.

## Part 1 — New supervisor function

New file: `supabase/functions/kids-repair-supervisor/index.ts`.

Behavior on each POST `{ ebook_id, run_id? }`:

1. Load the ebook, its latest run, its `qc_scorecard`, its latest failed step, and existing `storefront_meta.repair_supervisor` log.
2. Inspect state and pick ONE blocker in priority order:
   - `story_gate` failed → story repair
   - `metadata_gate` failed → metadata sync
   - `bible_check` failed → bible wipe + relock (already handled inline; supervisor just re-runs pipeline)
   - `KIDS_TITLE_TREATMENT_INVALID` → title treatment rerun
   - `CHARACTER_IDENTITY_BREAK` or vision consistency < 90 → targeted reroll of failing pages, then global style fallback if >6 pages fail
   - `PDF_GLYPH_MANGLING` → `kids-final-text-repair` + PDF rebuild
   - `WORKER_RESOURCE_LIMIT` → resume multi-stage PDF from last stage (no art regen)
   - `KIDS_MEASURED_QC_MISSING` → invoke only the missing QC subsystem
3. Dispatch to the matching existing function.
4. Persist attempt log to `storefront_meta.repair_supervisor` (append-only array).
5. Bounded attempts per blocker class (max 3 for story, 2 for art, 2 for PDF, 1 for title treatment).
6. After each repair, re-invoke `autopilot-kids-pipeline` with `force_finish=true` so completed steps are skipped.
7. Stop conditions:
   - measured QC passes → publish path handles it → return `published`
   - attempts exhausted → shelve (`listing_status=draft`, `sellable=false`, `pipeline_status=human_review_required`, record `storefront_meta.shelved` with exact blockers)
   - unrecoverable blocker (safety/compliance) → shelve immediately

The supervisor never calls image gateways directly; it only dispatches to existing repair functions. It also never lowers a threshold.

### Repair log shape (appended per attempt)

```json
{
  "attempt": 1,
  "current_blocker": "story_gate:rer=80<85,buyer=80<85",
  "repair_handler": "kids-surgical-story-repair",
  "stage_before": "story_gate",
  "stage_after": "story_gate",
  "result": "still_blocked",
  "scores_before": {"rer":80,"buyer":80},
  "scores_after":  {"rer":80,"buyer":70},
  "updated_at": "2026-07-13T..."
}
```

### Story judge cache reuse

If manuscript hash matches `storefront_meta.story_judge_cache.manuscript_hash`, the supervisor skips re-running the stochastic judge and treats the cached scores as the story-gate result. Cache is written by both `kids-surgical-story-repair` and the pipeline story_gate on pass.

## Part 2 — Bounded auto-tick

New file: `supabase/functions/kids-repair-tick/index.ts`.

Small helper the admin button hits after `kids-fresh-book-start`. Polls run status every ~20s (up to N iterations set by env, default 15). Each poll:
- if run status is `completed` and `listing_status=live` → return published.
- if run status is `failed` or `pipeline_status=human_review_required` → invoke `kids-repair-supervisor` once and continue polling.
- if global attempts exceed cap → mark shelved and return.

This is invoked once per user click; it does the whole "auto-fix until live or shelved" loop server-side with a hard iteration cap so it can never loop forever.

## Part 3 — Admin button behavior

Edit `src/components/admin/BuildKidsBookButton.tsx`:
- Swap the invoke target from `kids-book-start` to `kids-fresh-book-start` (already includes concept preflight).
- After it returns `{ ebook_id, run_id }`, fire `kids-repair-tick` with the run id.
- Show live per-stage status + last blocker + attempt count from `storefront_meta.repair_supervisor`. No thresholds shown as adjustable.

`src/pages/admin/KidsAutopilot.tsx` already renders the button — no route change needed. Only the button component and the row card that surfaces `repair_supervisor` progress will be updated.

## Part 4 — Run one fresh book end-to-end

After deploy, invoke `kids-fresh-book-start` once (age band `4-6`, humor theme, preferred lanes enforced by the existing preflight prompt). Then invoke `kids-repair-tick`. Observe:

1. Concept preflight → best of 1+2.
2. If preflight passes → seed ebook → pipeline → story_gate → (repair if needed) → metadata/bible → cover → style bible (`watercolor_soft` default) → 12 interiors → previews → multi-stage PDF → measured QC → publish only on strict pass.
3. If any recoverable blocker fires, supervisor picks the handler, retries with bounded attempts, and resumes.
4. If unrecoverable after budget, shelve honestly.

## Guardrails locked in code

- Thresholds live in `kids-story-judge`, `kids-qc-run`, and `kids-publish-if-qc-passed` — supervisor never edits them.
- Supervisor never sets `sellable=true` or `listing_status=live` directly; only `kids-publish-if-qc-passed` can.
- Supervisor never invokes Shopify.
- Supervisor never inserts reviews.
- Story-gate short-circuit in `autopilot-kids-pipeline` still prevents any art spend before the story passes.
- `pixar_3d` is already weight 0 in `kids_style_presets`; supervisor uses `watercolor_soft` for fallback.

## Bounded budgets

| blocker class | max supervisor attempts |
|---|---:|
| story_gate | 3 (surgical → general → general) |
| concept | 1 (preflight already does 1+2) |
| metadata_gate | 2 |
| bible_check | 1 (auto-wipe is one-shot) |
| character_identity / vision consistency | 2 (targeted reroll → global style fallback) |
| title_treatment | 1 |
| pdf_glyph | 1 |
| worker_resource_limit | 2 (multi-stage resume) |
| qc_missing | 1 per missing subsystem |
| overall supervisor loop | 12 total attempts hard cap |

## Technical details

- All new functions use `npm:@supabase/supabase-js@2` and `npm:@supabase/supabase-js@2/cors` per Cloud rules.
- Both new functions are stateless; state lives in `ebooks_kids.storefront_meta.repair_supervisor` and `autopilot_kids_runs`.
- No new tables required.
- `kids-repair-tick` uses `EdgeRuntime.waitUntil` to survive request timeouts; the client polls DB, not the tick response.
- Frontend polls `ebooks_kids` + `autopilot_kids_runs` (already used by `KidsAutopilot.tsx`) and reads `storefront_meta.repair_supervisor` for attempt breadcrumbs.

## Deliverables

Files created:
- `supabase/functions/kids-repair-supervisor/index.ts`
- `supabase/functions/kids-repair-tick/index.ts`

Files edited:
- `src/components/admin/BuildKidsBookButton.tsx` (invoke new starter + tick, show repair progress)
- `src/pages/admin/KidsAutopilot.tsx` (surface `repair_supervisor` attempt breadcrumbs on the row)

Functions deployed:
- `kids-repair-supervisor`, `kids-repair-tick`

Then one live run of the whole flow with the report the prompt asks for (concept scores, repair attempts, final scores, QC, listing_status/sellable, or shelved-with-blockers).

## What is explicitly NOT in this plan

- No new tables, no schema migrations.
- No threshold changes.
- No Shopify integration.
- No review seeding.
- No changes to `kids-story-judge`, `kids-qc-run`, or any existing repair handler's internals — only the supervisor wraps them.
- No pipeline rewrite; `autopilot-kids-pipeline` is called via `force_finish=true` so completed steps are skipped.
