
# Phase 1 — Self-Healing Ebook PDF Autopilot

Goal: **One click → one complete Shopify-ready ebook.** No manual fixes for recoverable issues. No SEO/blog work in this phase.

The factory already has ~90% of the moving parts (autopilot-pipeline, autopilot-recovery-worker, autopilot-doctor, autofix-action, qc-gates, recovery.ts, error-classifier). They currently don't cooperate as a single state machine, which is why runs get stuck. This plan **wires them into one canonical loop** and adds the missing pieces (preflight, dependency guard, canonical step table, per-step contract).

---

## Deliverables

1. **`preflight-check` edge function** — hard gate before any run starts.
2. **Canonical pipeline step model** — one enum, one status vocabulary, one row per step.
3. **Dependency guard + auto-repair router** inside `autopilot-pipeline`.
4. **Central repair map** used by both the pipeline and the recovery worker.
5. **Sequential Safe Mode** enforced by the existing locks (verified + fixed where broken).
6. **Autopilot Doctor upgrade** — runs preflight + fix map + creates Lovable Fix Prompts.
7. **One-Click Autopilot button** in Command Center that runs preflight → creates run → dispatches pipeline, and shows the live state defined below.
8. **KPI acceptance test** — script that starts one ebook from scratch and asserts final_status = `shopify_draft_uploaded`.

Out of scope: SEO/blog automation, publishing to live storefront, multi-book parallel production.

---

## 1. Preflight Check (`supabase/functions/preflight-check`)

New edge function. Returns exactly:

```json
{ "ready": true, "blocking_errors": [], "warnings": [], "auto_fixed": [], "required_admin_actions": [] }
```

Checks:
- DB connectivity + required tables (`ebooks`, `ebook_chapters`, `autopilot_pipeline_runs`, `autopilot_pipeline_steps`, `production_locks`, `system_fix_instructions`, `shopify_upload_queue`).
- Storage buckets `ebook-pdfs`, `ebook-covers` exist (auto-create if safe → `auto_fixed`).
- Secrets present: `LOVABLE_API_KEY`, `BROWSERLESS_TOKEN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`.
- Shopify: `shopify-test-connection` ping (token + shop domain + product scope) — missing scope ⇒ `required_admin_actions`.
- Browserless: HEAD request to `/pdf` endpoint.
- Production lock table reachable.
- Global heavy_production concurrency = 1 (auto-corrected if not).

Auto-fixable → performed silently. Non-recoverable → returned as `blocking_errors` and the run is refused.

`autopilot-pipeline` will call preflight as its first action; failure sets `run.status = failed_non_recoverable` with the exact admin instruction.

---

## 2. Canonical State Machine

### Step enum (one source of truth: `_shared/pipeline-steps.ts`)

```
start_run, preflight_check, generate_topic, title_generation, title_qc,
generate_outline, outline_qc, write_chapters, chapter_qc, build_manuscript,
reader_experience_qc, manuscript_qc, cover_strategy, cover_generation, cover_qc,
thumbnail_generation, thumbnail_qc, pdf_layout_generation, pdf_rendering,
pdf_screenshot_qc, pdf_qc, product_copy_generation, pricing_generation,
product_page_qc, shopify_draft_upload, shopify_verification, final_report
```

### Status vocabulary

```
pending, running, passed, passed_existing, skipped_valid_existing,
auto_fixing, repairing_dependency, waiting_for_quota,
waiting_for_browserless_slot, waiting_for_shopify_quota,
needs_code_fix, needs_admin_attention, failed_non_recoverable
```

### Row shape (`autopilot_pipeline_steps`)

Migration adds any missing columns so every row carries:
`status, started_at, completed_at, attempt_count, max_attempts, output_json, error_json, qc_score, repair_action, next_step, output_valid (bool)`.

**Invariant:** a step is never `passed` unless `output_valid = true` (validator per step lives in `_shared/step-validators.ts`).

---

## 3. Dependency Guard + Auto-Repair Router

New helper `_shared/deps.ts` with `runStepWithDeps(stepName, ctx)`. Before executing a step it runs the validator for each dependency. If a dep is missing/invalid:
1. Current step status ⇒ `repairing_dependency`.
2. Router calls the producer for the missing dep (using the repair map below).
3. On success, re-validates and re-enters the original step.

Concrete dependency map (matches the request exactly): title → outline → chapters → manuscript → reader_qc → cover → thumbnail → pdf → product_copy → pricing → shopify.

Replaces the ad-hoc `needsPdfRerender` / `needsCoverRerender` scattering.

---

## 4. Central Repair Map (`_shared/repair-map.ts`)

Single lookup: `{ failure_type × step } → repair_action`. Used by both `autopilot-pipeline` (inline repair) and `autopilot-recovery-worker` (out-of-band repair). Covers every case listed in the request:

| Failure                              | Repair action                                                                 |
|--------------------------------------|-------------------------------------------------------------------------------|
| outline missing / invalid            | regenerate-outline → validate `chapters[]`                                    |
| missing chapter                      | regenerate ONLY the missing index                                             |
| repetitive / robotic manuscript      | reader-qc targeted humanize loop (already exists, wired in)                   |
| weak title                           | premium-title-expert regen                                                    |
| weak cover                           | cover strategy regen → generate-cover                                         |
| pdf cover not full A4                | render-pdf with `force=true` (template already uses A4 full-bleed)            |
| raw markdown in PDF                  | rerender (already deterministic 0/100 gate); on repeat: strip markdown pre-render |
| worksheet wrong category             | regenerate worksheet for chapter category → rerender                          |
| worksheet overflow                   | wrap headers + split wide tables (existing wrapper) → rerender                |
| flat thumbnail                       | regen 3D mockup in generate-cover                                             |
| Browserless 429                      | set `waiting_for_browserless_slot`, backoff, `pdf_render_concurrency=1`       |
| Shopify daily cap                    | enqueue in `shopify_upload_queue`, status `waiting_for_shopify_quota`         |
| Shopify duplicate product            | PATCH existing draft instead of POST                                          |
| AI timeout / 5xx                     | withRetry backoff                                                             |
| Any of the above after 3 attempts    | classify via `error-classifier` → `needs_code_fix` OR `needs_admin_attention` |

Auto-fix loop: **max 3 attempts per gate, targeted only** (never rewrite the whole book to fix one chapter).

---

## 5. Resume From Last Good Step

`resumeRun(run_id)` in `autopilot-pipeline`:
1. Load `autopilot_pipeline_steps` for run.
2. Validate outputs for every `passed` step — downgrade to `pending` if the output no longer exists (URL 404, JSON invalid).
3. Start from the first step that isn't `passed / passed_existing / skipped_valid_existing`.
4. **Never regenerate** valid title / outline / chapters / cover / Shopify draft. For Shopify: PATCH existing draft ID stored on `ebooks.shopify_product_id`.

Add "Resume Pipeline" button in Command Center → invokes this.

---

## 6. Sequential Safe Mode (verify + enforce)

Locks are already in `_shared/recovery.ts`. This plan:
- Audits every call site to confirm `heavy_production`, `pdf_render`, `shopify_upload`, `browserless` locks are acquired/released.
- Adds a nightly stale-lock sweeper (already partially there; extend to all 4 locks).
- Adds `queue_position` display: `SELECT count(*) FROM ebooks WHERE autopilot_state='queued_for_production' AND created_at < me`.

---

## 7. Autopilot Doctor Upgrade

`autopilot-doctor` gains:
- Runs preflight-check first.
- Scans for every symptom in the request (duplicate runs, stale heartbeat, hidden jobs, raw-markdown-passed, wrong-worksheet-passed, flat-thumbnail-passed, PDF missing URL, Shopify missing fields).
- For code-bug class → inserts `system_fix_instructions` with a Lovable Fix Prompt template.
- For simple-fix class → invokes recovery worker / autofix-action directly.
- Reports a numeric health score (0–100) surfaced on Command Center.
- Scheduled: every 5 min via existing pg_cron; also runs before each One-Click start.

---

## 8. One-Click Autopilot UI

Command Center gets a single big **Start One Ebook** button that:
1. Calls `preflight-check`.
2. If blocked → shows exact admin actions, does not start.
3. If ready → creates one `autopilot_pipeline_runs` row, POSTs `autopilot-pipeline`.
4. Streams the live state:
   - **Currently Working On**: title, run id, step, action, subtask, %, heartbeat, elapsed.
   - **Queued Next** with position + waiting reason.
   - **Auto-Fixing** with attempt count + repair.
   - **Waiting/Auto-Retry** with `next_retry_at`.
   - **Needs Code Fix** with the generated Lovable Fix Prompt (copy button).
   - **Needs Admin** with the exact non-recoverable reason only.

Existing `AutopilotStatusCenter.tsx` / `LiveProductionQueue.tsx` already render most of this; changes are limited to sourcing everything from the new canonical step table and showing the new statuses.

---

## 9. KPI Acceptance Test

New `scripts/kpi-one-click.ts` (run locally against staging):
1. Insert seed idea, POST One-Click.
2. Poll every 15 s; assert progression through the canonical steps.
3. Assert final_status ∈ { `shopify_draft_uploaded`, `completed` }.
4. Assert artifacts: `pdf_url` set, `pdf_qc.pdf_cover_full_a4_score = 100`, `pdf_qc.raw_markdown_score = 100`, `thumbnail_url` set + `thumbnail_book_mockup_score ≥ 90`, `worksheet_relevance_score ≥ 95`, `shopify_product_id` set, `shopify_draft_url` present, `final_report_json` written.
5. Fail loudly if any of the "must-not-ship" conditions from the request are true.

---

## Technical Section (for engineers)

### New files
- `supabase/functions/preflight-check/index.ts`
- `supabase/functions/_shared/pipeline-steps.ts` (canonical enum + validators)
- `supabase/functions/_shared/deps.ts` (`runStepWithDeps`)
- `supabase/functions/_shared/repair-map.ts`
- `supabase/functions/_shared/step-validators.ts`
- `scripts/kpi-one-click.ts`
- `src/components/admin/OneClickAutopilotButton.tsx`

### Edited files
- `supabase/functions/autopilot-pipeline/index.ts` — replace ad-hoc step tracking with canonical model + deps guard + resume-from-last-good-step.
- `supabase/functions/autopilot-recovery-worker/index.ts` — dispatch via repair map; enforce sequential safe mode across all 4 locks.
- `supabase/functions/autopilot-doctor/index.ts` — preflight + symptom scanner + Lovable Fix Prompt generator.
- `supabase/functions/autofix-action/index.ts` — call sites now go through the repair map.
- `supabase/functions/render-pdf/index.ts` — leave scoring alone; ensure raw_markdown pre-render strip on repeat failure.
- `supabase/functions/shopify-draft-upload/index.ts` — PATCH-on-duplicate; enqueue on 429.
- `src/components/admin/AutopilotStatusCenter.tsx`, `LiveProductionQueue.tsx` — read new statuses + queue positions.

### Migrations
- `autopilot_pipeline_steps`: add `output_valid boolean default false`, `qc_score int`, `repair_action text`, `next_step text`, `max_attempts int default 3` where missing. GRANT to `authenticated`, `service_role`.
- `autopilot_pipeline_runs`: add `queue_position int`, `preflight_json jsonb`, `final_report_json jsonb`.
- Extend the `canonical_status` check constraint to accept the full status vocabulary above.

### Rollout order (safe, incremental)
1. Ship migrations + canonical step enum + validators (no behavior change).
2. Ship preflight-check + wire into autopilot-pipeline start.
329. Ship deps.ts + repair-map + rewire pipeline (biggest change; keep old paths behind a `USE_CANONICAL=1` flag for one deploy).
4. Flip flag on; run KPI script; iterate until green.
5. Ship UI: One-Click button + upgraded live view.
6. Delete legacy branches.

### Success criteria (must all be true)
- One click on `Start One Ebook` → within 5 s a run is visible in Command Center **and** Production.
- Run advances through every canonical step without human intervention.
- Only recoverable-class failures self-heal; anything else surfaces with either a Lovable Fix Prompt or an exact admin action.
- Final state = `shopify_draft_uploaded` with PDF URL, full-A4 cover, 3D mockup thumbnail, product title/description/price, Shopify draft URL, and final report.
- KPI script passes in CI-style run against staging.
