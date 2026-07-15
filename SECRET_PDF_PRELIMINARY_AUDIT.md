# SecretPDF — Preliminary Architecture Audit (P0, Step 1)

Freeze in force: **no new book creation initiated**; in-flight runs preserved; no code behavior changed by this document.

Evidence in this audit was verified against the repo (paths + line ranges cited). Where a claim depends on runtime data, it is marked *runtime-verify*.

---

## 1. Kids production entry points (call graph)

Distinct triggers that can start or resume a kids production step today:

| # | Entry point | File | Downstream it invokes |
|---|---|---|---|
| 1 | Admin one-click UI | `src/components/admin/OneClickAutopilotButton.tsx`, `BuildKidsBookButton.tsx` | `kids-one-click-build` OR `kids-fresh-book-start` (two paths coexist) |
| 2 | Parent orchestrator (old kids track on `ebooks`) | `supabase/functions/autopilot-kids/index.ts` | `rewrite-kids-manuscript`, `generate-cover`, `render-pdf`, `qc-check`, `kids-publish-if-qc-passed` |
| 3 | Parent orchestrator (new kids track on `ebooks_kids`) | `supabase/functions/autopilot-kids-orchestrator/index.ts` | `autopilot-kids-pipeline` |
| 4 | Sequential pipeline runner | `supabase/functions/autopilot-kids-pipeline/index.ts` | `kids-render-interior`, `kids-build-picture-pdf`, `kids-qc-run`, `kids-publish-if-qc-passed`, repair fns |
| 5 | Admin explicit start | `supabase/functions/kids-book-start/index.ts` | `autopilot-kids-pipeline` |
| 6 | Fresh-book starter (background task) | `supabase/functions/kids-fresh-book-start/index.ts` | `kids-concept-preflight`, then `autopilot-kids-pipeline` |
| 7 | One-click parent loop | `supabase/functions/kids-one-click-build/index.ts` | Creates ebook + run, calls `autopilot-kids-pipeline`; supervises repairs |
| 8 | Batch producer (cron) | `supabase/functions/kids-batch-producer/index.ts` | `kids-one-click-build` |
| 9 | Watchdog (cron) | `supabase/functions/kids-autopilot-watchdog/index.ts` | Directly resumes `autopilot-kids-pipeline` and dispatches repairs |
| 10 | Repair supervisor + repair-tick (cron) | `kids-repair-supervisor`, `kids-repair-tick` | Dispatch `kids-repair-story-gate`, `kids-repair-book`, `kids-repair-cover*`, `kids-surgical-story-repair`, `kids-full-repair`, `kids-final-text-repair`, `kids-restandardize-book`, `kids-regenerate-offmodel-pages`, then resume pipeline via `force_finish` |
| 11 | Interior render worker | `kids-render-interior` | Calls back into `autopilot-kids-pipeline` with `force_finish:true` |

**Finding 1.1 — Multiple orchestration paths.** Entries 2, 3+4, 6, 7, and 8 are all "orchestrators" by behavior. Entries 9/10/11 also mutate run state and jump into the pipeline. State-transition logic is spread across ≥5 functions.

**Finding 1.2 — Two triggers create the ebook row differently.** `kids-fresh-book-start` uses **hardcoded UUIDs** for age group + theme (lines 14–15) — these do not match this project's seeded rows and will FK-fail on first insert. `kids-one-click-build` resolves the same defaults **by slug** (lines 24–33). Same intent, two implementations, one broken.

**Finding 1.3 — Repair workers resume the pipeline directly.** `kids-repair-*` fire-and-forget POST to `autopilot-kids-pipeline` with `force_finish:true` (§4). No shared idempotency contract with the parent state machine.

## 2. Data models in use

| Path | ebook table | run table | step table | status column(s) |
|---|---|---|---|---|
| `autopilot-kids` (entry 2) | `ebooks` | `autopilot_pipeline_runs` (shared with adult) | `pipeline_step_logs` | `ebooks.autopilot_state` |
| `autopilot-kids-pipeline` + friends (entries 3–11) | `ebooks_kids` | `autopilot_kids_runs` | `autopilot_kids_steps` | `ebooks_kids.pipeline_status`, `.status`, `.listing_status`, `.autopilot_state`, `autopilot_kids_runs.status` + `current_step` |

**Finding 2.1 — Two independent data models for one production system.** QC verdicts written by `autopilot-kids` land in adult tables; QC verdicts from `autopilot-kids-pipeline` land in kids tables. There is no single scorecard truth per book.

**Finding 2.2 — Overlapping status columns on `ebooks_kids`.** `pipeline_status`, `status`, `listing_status`, `autopilot_state` all mutate independently. Repair races (§8) exploit this.

## 3. Canonical steps vs Phase 1 flag

`src/config/features.ts` and `supabase/functions/_shared/features.ts` set `PHASE_1_PDF_ONLY = true`. But:

- `supabase/functions/_shared/pipeline-steps.ts` `CANONICAL_STEPS` still includes `product_copy_generation`, `pricing_generation`, `product_page_qc`, `publish_live` (adult track).
- The kids pipeline's terminal step is `dispatch_pdf_qc_publish` (`autopilot-kids-pipeline/index.ts:53`, policy = `retire`). The name and the dispatched worker `kids-publish-if-qc-passed` fold **publishing** into the PDF-completion gate.

**Finding 3.1 — Phase 1 is not actually PDF-only.** A publish failure (storefront copy, price, thumbnail contract, listing_status flip) will fail the "PDF complete" step and mark the concept `retire`, discarding a viable book.

## 4. QC producer → persistence → gate map (kids)

- Producer: `kids-qc-run` writes to `qc_reports` + `qc_findings` + updates `ebooks_kids.storefront_meta.qc_scorecard`.
- Gate: `kids-publish-if-qc-passed` re-reads scorecard; `_shared/qc/kids.ts` also enforces `kidsPublishGate`.
- Repair loop: `kids-repair-supervisor` reads scorecard and dispatches targeted repairs.
- Story gate (pre-art): `story_gate` step in `autopilot-kids-pipeline` calls `runKidsStoryJudge`; repair goes to `kids-repair-story-gate`.
- PDF gate: `_shared/pdf-preflight.ts` (bytes + page-count 24–96).

**Finding 4.1 — No single source of truth per dimension.** `pdf_preflight`, `story_gate`, `qc_scorecard`, and `kidsPublishGate` each compute independently. Some read the fresh PDF bytes; some read a cached signed URL (see F.4 below).

**Finding 4.2 — Zeroing missing input.** Historical regressions repeatedly stored `0` for a dimension when the input asset was absent (signed-URL expiry, missing manuscript, missing scorecard field). Rule for canonical model: **missing input = `null` / `not_evaluated`, never `0`**.

## 5. Final PDF asset contract

Today: `ebooks_kids.pdf_url` (signed URL) + occasionally `pdf_path`. No content hash. No version. No page-count field. No verifier record.

**Finding 5.1 — Asset contract undefined.** The canonical model must include: `pdf_storage_path`, `pdf_bytes_sha256`, `pdf_page_count`, `pdf_bytes_size`, `pdf_signed_url` (transient, never a QC input), `pdf_generated_at`, `pdf_generator_version`.

## 6. Duplicate / legacy paths → quarantine candidates

Recommend quarantining behind a feature flag with zero-call telemetry (do not delete until acceptance passes):

1. `autopilot-kids/index.ts` (old `ebooks`-based kids orchestrator).
2. `kids-fresh-book-start/index.ts` — broken hardcoded FK UUIDs; `kids-book-start` covers the same case correctly.
3. `autopilot-kids-orchestrator/index.ts` — weighted-random launcher; overlaps with `kids-batch-producer`.
4. `kids-full-repair`, `kids-repair-book`, `kids-restandardize-book` — repair fan-out that duplicates `kids-repair-supervisor` responsibilities.
5. `kids-final-text-repair`, `kids-regenerate-offmodel-pages`, `kids-surgical-story-repair` — keep as **targeted repair workers** callable *only* by the canonical orchestrator via typed recovery (§7).
6. `autopilot-kids-orchestrator` concurrency=2 and `kids-book-start` concurrency=3 checks — both removed in favor of DB lease (§7).

## 7. Concurrency contradiction

- `kids-one-click-build` — singleton (one parent run at a time).
- `autopilot-kids-orchestrator/index.ts:34` — allows **2** active `autopilot_kids_runs`.
- `kids-book-start/index.ts:59` — allows **3** active runs.
- `production_locks` table + `try_acquire_lock` RPC exist but are used only by `heavy_production` / `pdf_render` — not by orchestrator dispatch.

**Finding 7.1 — No single lease authority.** Row counting (`.in('status', ['queued','running'])`) is racy and disagrees with itself across entry points. Canonical fix: DB-backed lease `(owner, acquired_at, heartbeat_at, expires_at)` with heartbeat renewal and takeover only on expiry; use `try_acquire_lock` for all four resources (parent job, heavy content, image batch, PDF assembly).

## 8. Status / repair races

Observed pattern:
1. `autopilot-kids-pipeline` step throws → run row status set to `failed`, `completed_at` stamped.
2. Repair supervisor picks up `ebooks_kids.pipeline_status = 'story_gate_repairing'` and dispatches a repair worker.
3. Repair worker succeeds, POSTs `force_finish:true`.
4. Pipeline runner loads run, sees `status='failed'` … but proceeds anyway in some branches, or bails in others.

**Finding 8.1 — Terminal status set while repair is live.** Finalization is not compare-and-set; there is no "waiting_async_child" state; the run row and the ebook row disagree.

Canonical states to adopt: `queued`, `running`, `waiting_provider`, `waiting_rate_limit`, `repairing_content`, `repairing_dependency`, `waiting_async_child`, `final_qc`, `completed`, `needs_code_fix`, `needs_admin_config`, `retired_content`. Repair dispatch must set the parent to `repairing_content` / `waiting_async_child` and store the child job id; only the orchestrator may transition to a terminal state via compare-and-set.

## 9. Failure-policy destructive retirement

`STEP_FAILURE_POLICY` (autopilot-kids-pipeline/index.ts:71-83):
```
generate_idea/manuscript/metadata_gate/bible_check/cover/style_bible/interior/dispatch_pdf_qc_publish → 'retire'
story_gate → 'repair_story_gate'
thumbnail/previews → 'soft'
```

**Finding 9.1 — Retirement is used for transient failures.** Provider 5xx, browserless throttling, signed-URL expiry, persistence errors, and asset-contract mismatches will retire a viable concept instead of resuming from checkpoint. Replace with typed recovery:

| Class | Handler |
|---|---|
| `content_quality_failure` | Targeted repair; bounded attempts; if exhausted → `retired_content` |
| `dependency_missing` | Generate dependency then resume from checkpoint |
| `provider_transient` / `rate_limit` | Backoff retry; **do not consume repair budget**; **do not lower gates** |
| `persistence_failure` / `asset_contract_violation` | `needs_code_fix`; preserve book; open incident |
| `deterministic_code_bug` | Stop new books; failing regression test first; patch; resume |
| `nonrecoverable_config` | `needs_admin_config` with exact instruction |

## 10. Skill learning vs code repair — conflation

`kids-skill-learner` currently reacts to many failure classes as if they were writing-craft deficiencies. But state/persistence/renderer/asset/queue/QC-wiring bugs are **code** incidents.

**Finding 10.1 — Rules to adopt.**
- Skill learner: manuscript-quality dimensions only. New version must (a) actually load in production runs, (b) be recorded in the run's `skill_versions`, (c) show before/after eval on the same manuscript, (d) rollback automatically on regression.
- Code repair: minimal repro test → git patch → typecheck/test/build → the blocker class is "fixed" only after the regression test is added and passes.

## 11. Build / test / typecheck health

- `bun.lockb` **and** `package-lock.json` both present in repo root. `npm ci` fails because npm's lock is not synchronized with the installed dependency tree that bun manages.
- No `typecheck` script in `package.json`; only `lint`, `test` (vitest), `build`.
- No CI-visible edge-function typecheck.

**Finding 11.1 — Standardize on bun.**
- Remove `package-lock.json`; keep `bun.lockb`.
- Add scripts: `"typecheck": "tsgo -p tsconfig.app.json"`, `"typecheck:functions": "deno check supabase/functions/**/index.ts"`.
- Document `bun install && bun run typecheck && bun run lint && bun run test && bun run build` in `CLAUDE.md` (added).

## 12. Regression-test list (must exist before P0 closes)

One failing test per fixed blocker class, each pinned to a permanent name in the repo:

1. `manuscript.json_parse_or_fallback` — writer JSON malformed → falls back deterministically, never crashes the run.
2. `missing_manuscript.no_cascade` — if manuscript is absent, downstream gates report `not_evaluated`, not `0`; run enters `dependency_missing`.
3. `repair.parent_nonterminal_during_child` — repair dispatch keeps parent nonterminal; finalization is CAS-idempotent.
4. `orchestrator.single_router` — every entry point routes through the canonical orchestrator (test asserts by grep + runtime dispatch).
5. `lease.singleton_under_race` — two orchestrator calls in the same tick → only one acquires; the other observes lease.
6. `pdf.hash_contract` — final PDF has `pdf_bytes_sha256`, `pdf_page_count`, `pdf_bytes_size` recorded; retry produces identical hash when inputs identical.
7. `qc.signed_url_expiry_not_zero` — expired signed URL yields `not_evaluated`, never `0`.
8. `interior.reference_propagation` — every interior prompt receives the locked visual bible + cover reference.
9. `pdf.canonical_page_order` — cover / TOC / interior / back-cover order enforced; test fails if any page missing.
10. `text.no_watermark_or_markdown` — final PDF text extraction must not contain watermark strings, raw markdown, or model chatter.
11. `skill.version_loading` — a bumped skill version is present in the run's `skill_versions`; rollback path exercised.
12. `phase1.no_phase2_dependency` — Phase-1 pipeline must not call any function whose contract includes `publish:true` / storefront copy / pricing.

## 13. Recommendations (to decide in Step 2/3)

**Canonical orchestrator:** consolidate on `autopilot-kids-pipeline` **renamed conceptually to `kids-orchestrator`**, extended to own: entry-point routing, DB lease, typed recovery, checkpoint resume, repair dispatch as async children, CAS finalization, final report. All other functions become **workers** it calls; none of them mutate run state directly.

**Canonical data model:** keep the `ebooks_kids` family. Add columns: `pdf_bytes_sha256`, `pdf_page_count`, `pdf_bytes_size`, `pdf_generator_version`, `pdf_generated_at`, `skill_versions jsonb`, `repair_history jsonb`, `final_report jsonb`, `orchestrator_state text` (replaces the overlapping status columns; existing columns become derived views during migration). Add lease columns / rows to `production_locks` for `kids_parent`, `kids_content`, `kids_image_batch`, `kids_pdf_assembly`.

**Phase 1 terminal step:** rename `dispatch_pdf_qc_publish` → split into `final_pdf` + `final_qc` + `final_report`. **No publish step in Phase 1.** `kids-publish-if-qc-passed` remains, but is only invoked outside Phase 1 by an explicit Phase-2 trigger.

**Quarantine plan:** flag `KIDS_LEGACY_ROUTES_ENABLED=false`; wrap entry points 2, 3, 6 in a `if (!enabled) return json({ quarantined: true }, 410)` guard; add telemetry counter; archive after three consecutive acceptance passes.

## 14. Freeze status

- New book creation via `kids-batch-producer` cron: **pause** (set `kids_batch_orders.status='paused'` — one row toggle, not code change, since audit is code-frozen).
- One-click UI: leave enabled (admin-supervised) but display a banner "P0 audit in progress — Step-2 canonical orchestrator not yet deployed."
- In-flight runs: continue to completion; no forced kills.

---

**Next action (Step 2):** propose the canonical orchestrator interface (single function signature, entry-point adapters, lease acquisition, state machine, typed recovery dispatch table, checkpoint contract). No code changes will be made until this proposal is confirmed.
