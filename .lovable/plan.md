
# Goal
Get **one brand-new coloring book** all the way to LIVE today, using Runware as the primary image provider, and hold it to **strict (not learning-mode)** QC so it's a genuinely high-quality release — not a Round-1 waivered one.

# Why a focused single-book run
The queue currently has 30+ books cycling with waived defects (learning mode) and Ideogram/Gemini cover typography exhausted. Trying to push all of them in strict mode today will re-stall on cover typography and defect ledgers. A single fresh book, on the healthy provider (Runware), through strict gates, is the fastest way to prove the pipeline end-to-end today and give you one clean live SKU.

# Plan

## 1. Pre-flight (verify, don't assume)
- Confirm Runware is currently primary in `generation_settings.coloring_autopilot.image_provider_policy` and no `provider_billing_blocked.runware.active` latch is set.
- Confirm recent `cost_log` rows with `provider='runware_direct'` in the last hour (proves the provider path is actually flowing, not just configured).
- Confirm Ideogram/Gemini cover-typography status. If still exhausted, the baked-title cover contract cannot be satisfied today for a strict-QC book — surface this before starting so you can decide: (a) top up, or (b) accept the run will park at cover-typography.

## 2. Pick / seed the one book
- Pick a category with full species-anatomy coverage (e.g. Farm Animals or Dinosaurs — both have contracts registered) to avoid the coverage-gate blocker.
- Enqueue exactly one new `ebooks_kids` row via the existing autopilot config path (age band of your choice from the chip UI), tagged with a run marker like `metadata.focus_run='2026-07-17-strict-1'` so we can track it distinctly from the 30 in-flight books.

## 3. Run this book in STRICT mode (per-book override)
- Introduce a per-book `qc_mode_override` read by `readQcMode()` in `_shared/coloring/qc-mode.ts`: if `ebooks_kids.metadata.qc_mode_override === 'strict'`, use strict regardless of the global `coloring_autopilot.qc_mode`. This way the 30 in-flight learning-mode books are unaffected.
- Set that override on the new row only.

## 4. Prioritize this book in the dispatcher
- `coloring-worker-tick` currently picks a widened candidate window with a 90s cooldown. Add a lightweight priority: rows with `metadata.focus_run` set are ordered first in the candidate query (single boolean order-by, no schema change). This guarantees Runware capacity spends on the focus book first each tick.

## 5. Cover-typography contingency (decide up front)
Two clean options — pick one before we start; do NOT invent a third:
- **(a) Wait for Ideogram/Gemini top-up.** The book will complete interiors on Runware, then park at cover-typography until credit exists. Strict-QC preserved. Recommended if you can top up today.
- **(b) Accept an Ideogram-free cover ladder for THIS one book only.** Requires an explicit, logged, one-book waiver of the baked-title-only contract. This violates the current cover contract and should not be done silently. I'd only do this on your explicit say-so.

## 6. Watch to LIVE
- Poll the row every ~60s: render progress, cost_log runware rows, gate outcomes, publish-contract result.
- On success: report `pdf_url`, `cover_url`, `thumbnail_url`, `listing_status='live'`, page count, and per-provider cost breakdown.
- On any strict-gate failure: stop and surface the exact gate + evidence — do NOT auto-waive.

## 7. Do NOT touch
- The 30 in-flight learning-mode books.
- Global `qc_mode`, provider policy defaults, or gate thresholds.
- fal.ai routing (stays out of rotation per your prior order).

# Technical details
- Files that would change (small, contained):
  - `supabase/functions/_shared/coloring/qc-mode.ts` — honor per-row `metadata.qc_mode_override`.
  - `supabase/functions/coloring-worker-tick/index.ts` — order candidates by `metadata.focus_run IS NOT NULL DESC` before existing ordering.
- No schema migration required (uses existing `metadata` jsonb).
- No changes to publish contract, species anatomy, cover contract, or provider adapters.

# Open decisions I need from you before I write the plan into code
1. **Category for the focus book?** Farm Animals or Dinosaurs are safest (full anatomy coverage). Or pick another and I'll verify coverage first.
2. **Age band?** (2–4, 4–6, 6–8, 8–12, 13–17, All Ages)
3. **Cover-typography contingency: (a) wait for Ideogram/Gemini top-up, or (b) authorize a one-book baked-title waiver?**

Once you answer those three, I'll switch to build mode and execute.
