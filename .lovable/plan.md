# Coloring Lane V2 — Full Pipeline Build + Test Book

Isolated V2 lane (feature-flagged, `coloring_v2_*` tables, `coloring-v2-*` functions, `coloring-v2` bucket) already has `coloring-v2-start` and admin UI. This plan builds the remaining stages, wires them into a single tick loop, and ships a 32-page Ages 13-17 test book.

## Pipeline Contract

```text
start (queued)
 → concept        → style_bible
 → page_plan      → interior_render (per page, parallel, N=32)
 → cover_master   → cover_compose
 → qc_visual      → repair_loop? (max 2)
 → pdf_build      → publish (sellable=true)
```

State stored in `coloring_v2_books.stage` + `coloring_v2_steps` (one row per stage attempt). All artifacts land in `coloring_v2_assets` with `kind` = `concept|style_bible|page_plan|interior|cover_master|cover_final|pdf`.

## New Edge Functions

1. **coloring-v2-concept** — Gemini 2.5 Pro. Input: theme, age band, page count. Output: title (short, catchy, spelling-locked), subtitle, hero list, motif inventory, parent hook. Stored on `coloring_v2_books` + asset row.
2. **coloring-v2-style-bible** — Gemini 2.5 Pro. Age-to-art matrix (2-4 chunky, 4-6 simple, 6-8 medium, 8-12 detailed, 13-17 intricate/mandala, all-ages balanced). Emits line-weight, complexity score, negative prompts, ref palette. Persist to `coloring_v2_style_bibles`.
3. **coloring-v2-page-plan** — Gemini 2.5 Pro. N distinct scenes, anti-clone check vs prior pages. Persist to `coloring_v2_page_plans` (1 row per page).
4. **coloring-v2-render-page** — Runware `ideogram:4@1`, square 1088×1088, coloring-book prompt template + style bible refs. Anatomy/deformity gate reused from `_shared/coloring/anatomy-verify.ts`. Writes to `coloring-v2` bucket + `coloring_v2_assets`. Retries: max 2, then flag page for repair.
5. **coloring-v2-cover** — runs only after ≥60% interiors done. Uses 3 interior refs + master-cover-prompt. Square 1088×1088. Title shrink-to-fit typography overlay.
6. **coloring-v2-qc** — Gemini 2.5 Pro vision. Per-page findings → `coloring_v2_qc_findings`. Hard gates: title spelling, anatomy, cover-interior style match. Soft gates logged.
7. **coloring-v2-repair** — regenerates only failed pages (max 2 attempts each), then re-QC.
8. **coloring-v2-pdf** — 8.5×8.5 square trim, cover-first, interior sequence from page plan order. Stored in `ebook-pdfs/v2/` + `coloring_v2_pdf_artifacts`.
9. **coloring-v2-publish** — inserts/updates `ebooks_kids` row (existing storefront), sets `sellable=true`, `book_type='coloring_book'`, links cover/pdf/thumb, logs event.
10. **coloring-v2-tick** — cron-driven dispatcher: picks next book by stage, calls the right function, advances stage, respects `ENABLE_COLORING_LANE_V2` flag + `autopilot_frozen` kill-switch. Also handles heartbeat.

## Shared Modules

- `_shared/coloring-v2/prompts.ts` — concept, style bible, page plan, render, QC prompt builders keyed by age band.
- `_shared/coloring-v2/age-matrix.ts` — line weight, complexity, allowed motifs, forbidden motifs per band.
- `_shared/coloring-v2/state.ts` — atomic stage advance via `atomic_patch_ebooks_kids_meta`-style RPC (new: `coloring_v2_advance_stage`).
- Reuses: `_shared/coloring/anatomy-verify.ts`, `_shared/coloring/master-cover-prompt.ts`, `_shared/coloring/metadata-bloat-guard.ts`, `_shared/direct-fallback.ts`.

## DB Migrations

- Add `stage`, `stage_updated_at`, `attempt_count`, `last_error` to `coloring_v2_books` if missing.
- New RPC `coloring_v2_advance_stage(p_book uuid, p_from text, p_to text, p_patch jsonb)` — CAS-style, prevents race.
- Storage: reuse `coloring-v2` bucket (private, admin RLS).

## Frontend

- `/admin/coloring-lab-v2` — add live progress table (stage, attempts, last_error) polling `coloring_v2_books` + `coloring_v2_steps`. Manual "advance" and "retry stage" buttons.
- Existing preview `/coloring-preview-v2/:bookId` — render pages from `coloring_v2_assets`.

## Feature Flag Rollout

- Set `platform_settings.enable_coloring_lane_v2 = true` behind admin toggle.
- `coloring-v2-tick` no-ops when flag off.

## Test Book (Phase 2)

After all functions deploy + smoke test one page render:
- Kick `coloring-v2-start` with `{ theme: "Mystic Mandalas & Sacred Geometry", ageBand: "13-17", pages: 32 }`.
- Watch tick advance through all stages.
- Success = row in `ebooks_kids` with `sellable=true`, cover + 32 interior pages, PDF ≤ 40MB, QC passed, visible in storefront.

## Non-Goals

- No Shopify, SEO, royalty wiring.
- No changes to V1 coloring lane or novel lanes.
- No changes to age bands beyond what's already in `coloring_v2_age_bands`.

## Estimated Rollout

- Migrations + shared modules: 1 turn
- Functions 1–5 (concept → cover): 2 turns
- Functions 6–10 (QC → tick): 2 turns
- Admin UI polling + flag toggle: 1 turn
- Deploy + smoke test: 1 turn
- Fire test book + verify: 1 turn

Total ~8 turns. Each turn ends with a clear checkpoint before proceeding.
