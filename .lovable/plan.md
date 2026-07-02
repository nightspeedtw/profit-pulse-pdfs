
# Autopilot Readiness Audit — Phase 1

## Readiness score: 58 / 100

Foundations are in place (pipeline runs, sequential lock, recovery worker, live queue UI, cover/PDF engines), but the data model, canonical step list, and dependency validation are inconsistent enough that a fresh One‑Click run cannot reliably finish end‑to‑end without manual nudges.

---

## 1. Inventory — what's in use vs deprecated

**Canonical tables (keep):**
- `ebooks` (28 rows) — source of truth for book state + assets.
- `autopilot_pipeline_runs` (506) — one row per run, dedupe trigger now active.
- `autopilot_pipeline_steps` (10 626) — per-step attempts, auto-fix counters.
- `pipeline_step_logs` (720) — structured step logs.
- `shopify_upload_queue` (6) — quota-aware upload queue.
- `production_locks` (0) — `heavy_production` sequential lock.
- `system_fix_instructions` (0) — Lovable "Needs Code Fix" bugs.
- `ebook_chapters` (190) — separate chapter storage (some code paths read chapters from `ebooks.chapters` JSON, some from here — inconsistent).

**Deprecated / unused (should be retired or ignored):**
- `autopilot_runs` (2 392 legacy rows) — old table, still referenced in a few places.
- `production_queue` (0) — replaced by `ebooks.queue_position` + lock.
- `ebook_assets` (0) — never populated; assets live on `ebooks.cover_url`, `pdf_url`, `cover_bg_url`, etc.
- `qc_reports` (0) — never populated; QC lives on `ebooks.*_qc` JSON columns.

**Symptoms:** `canonical_status` column on `ebooks` is NULL for every row (28/28). Real state lives in `autopilot_state` + `status` (two fields, sometimes disagreeing). `admin-data` was patched to coalesce them, but downstream UI/decision code still branches on the wrong column.

---

## 2. Critical blockers (must fix for Phase 1)

| # | Blocker | Current | Required | Files |
|---|---|---|---|---|
| B1 | `canonical_status` never written | 28/28 NULL; live queue relies on legacy `autopilot_state` | RunTracker syncs `canonical_status` on every step transition | `supabase/functions/_shared/run-tracker.ts` |
| B2 | Canonical step list drift | Pipeline uses 21 steps (`title_and_hook`, no `cover_strategy`, no `pricing`) — audit spec wants 24 | Single `CANONICAL_STEPS` constant with 24 steps, imported everywhere | `_shared/run-tracker.ts`, `autopilot-pipeline/index.ts`, `LiveProductionQueue.tsx`, `AutopilotStatusCenter.tsx` |
| B3 | Resume logic starts at `start_run` | Restart-from-scratch on retry | `validateStepDependencies()` skips any step whose output already exists on the ebook; resume continues at first incomplete step | `autopilot-pipeline/index.ts` |
| B4 | Chapters read/write is dual-sourced | Some functions read `ebooks.chapters`, others `ebook_chapters` table | Pick one (recommend `ebook_chapters` + view) and adapt writers | `write-chapters`, `final-manuscript-qc`, `build-pdf` |
| B5 | Non-recoverable errors marked recoverable and vice versa | Browserless 429 sometimes marked `failed`, weak QC sometimes escalates to admin on attempt 1 | Route every error through `_shared/error-classifier.ts` and use the 7-bucket model | `autopilot-pipeline`, `render-pdf`, `push-to-shopify` |
| B6 | No pricing step | Price is set inline; no `pricing_generation` step, no `product_page_qc` | Add both as pipeline steps with QC gate | new logic in `autopilot-pipeline` + `compute-pricing` |

## 3. Major issues

- M1 — `LiveProductionQueue` sections still miss "Auto-Fixing" counts because `ebooks.canonical_status` is NULL (see B1).
- M2 — `autopilot-recovery-worker` cron polls but doesn't check the `heavy_production` lock before re-queuing.
- M3 — `write-chapters` reruns already-passing chapters when an earlier chapter fails QC.
- M4 — `final-manuscript-qc` doesn't rebuild manuscript from `ebook_chapters` when JSON is empty (fix shipped previously but broke after B4 drift).
- M5 — PDF QC thresholds are stored inline in `build-pdf` and `pdf_qc` — not one canonical config; a single `QC_THRESHOLDS` const is needed.
- M6 — Shopify upload doesn't consult `shopify_upload_queue` first; races the daily cap.

## 4. Minor issues

- m1 — `production_queue`, `ebook_assets`, `qc_reports`, `autopilot_runs` still queried in a handful of legacy files → dead code.
- m2 — Focus badge polls every 5 s; can share the `admin-data live_queue` payload the dashboard already fetches.
- m3 — `SystemFixCard` "Fix All" copies fixes in a single blob; Lovable prefers one prompt per bug.

---

## 5. Prioritized Fix Plan (Phase 1 only — no SEO, no blog)

**P1 — Visibility (unblocks everything).** Backfill `canonical_status` for existing ebooks, patch `RunTracker.syncEbook()` to always write it, remove the `autopilot_state` fallback in `admin-data/live_queue`, and add "current subtask + last heartbeat age + next retry" columns to `LiveProductionQueue`. *Test:* click Autopilot → within 5 s the new run appears in "Currently Working On" with a non-null `canonical_status`.

**P2 — Sequential Safe Mode audit.** Confirm `heavy_production` lock is acquired around chapter writing, PDF render, and Shopify upload only. Topic/title generation stays parallel. Add a lock-holder banner check inside `autopilot-recovery-worker` so it never re-queues a book while another holds the lock. *Test:* trigger 3 One-Click runs; only 1 heavy step runs at a time, others show queue positions 1..N.

**P3 — Canonical state machine (24 steps).** Introduce `supabase/functions/_shared/canonical-steps.ts` exporting the exact list from the spec (`start_run … final_report`). Rename `title_and_hook → title_generation` + add `title_qc`, split `cover → cover_strategy + cover_generation`, add `pdf_layout_generation`, `pricing_generation`, `final_report`. Update `AUTOPILOT_STEPS`, `STEP_TO_CANONICAL`, `stepIndex()`, and every UI label. Add `validateStepDependencies(step, ebook)` gate at the top of every `runStep()`. *Test:* delete `outline_json` mid-run → next tick regenerates outline instead of continuing.

**P4 — Auto-recovery classifier.** Wrap every `runStep()` failure in `classifyError()` (already in `_shared/error-classifier.ts`) and dispatch:
- `recoverable_qc_error` / `recoverable_dependency_error` → repair in-place, up to 3 attempts.
- `temporary_api_error` → exponential backoff, don't count toward auto-fix cap.
- `quota_wait` (Browserless / Shopify) → set `waiting_for_*`, keep assets, recovery worker resumes.
- `config_error` / `non_recoverable` → `system_fix_instructions` row OR `needs_admin` with exact fix text.
*Test:* simulate a 429 from Browserless → status flips to `waiting_for_browserless_slot`, run resumes without losing chapters.

**P5 — PDF quality gate.** Move all thresholds to `_shared/qc-thresholds.ts` (`cover ≥ 90, thumbnail ≥ 90, content ≥ 90, worksheet ≥ 90, table_overflow = 100, diagram ≥ 90, illustration_relevance ≥ 90, visual_fatigue ≥ 90, compliance ≥ 90, final_premium ≥ 90`). `pdf_qc` step reruns targeted repairs (worksheet wrap/split, add illustration, fix contrast) until pass or 3 attempts. *Test:* one full run reaches `final_pdf_premium_score ≥ 90`.

**P6 — Shopify draft reliability.** Precondition check (`shopify-test-connection` returns 200, PDF + cover + product copy + price present, no duplicate title/handle). If daily cap hit → enqueue in `shopify_upload_queue` with `waiting_for_shopify_quota`. Recovery worker retries on quota reset. `shopify_verify` step confirms product ID + draft status. *Test:* upload succeeds and `shopify_status = 'draft'` + `shopify_product_id` populated; a second run with the same title reuses the existing draft.

**P7 — KPI test: One-Click run to green.** Trigger a full Autopilot on a fresh idea and verify:
1. Command Center + Production show the run within 5 s.
2. `NOW RUNNING` badge and queue positions render.
3. Status updates every 3–5 s.
4. Any injected failure auto-recovers.
5. Final ebook: PDF ≥ 90, Shopify draft uploaded + verified, `final_report` written.
6. `system_fix_instructions` remains empty (no structural bugs), `needs_admin` empty.

---

## 6. What I want to confirm before starting

1. **Chapter storage:** consolidate on `ebook_chapters` (relational, per-chapter QC, no 8 MB JSON limit) or keep `ebooks.chapters` JSON? Recommend `ebook_chapters`.
2. **Legacy `autopilot_runs` (2 392 rows):** archive/drop, or leave read-only? Recommend archive after P1 lands.
3. **Shopify upload target:** every completed ebook auto-uploads, or gated on the existing `settings.autopilot_upload_to_shopify` flag (currently OFF so runs stop at 100 %)?
4. **Test ebook to use for P7 KPI run:** pick an existing idea or generate a fresh one on the KPI step?

Once you confirm these four points, I'll switch to build mode and execute P1 → P7 in order, running the targeted test after each priority and reporting pass/fail before moving on.
