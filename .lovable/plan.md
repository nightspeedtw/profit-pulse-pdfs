## Goal

Make every ebook show a clear "QC Gate Card" — Formatter QC / Reader QC / Cover QC scores vs. the premium-ebook-master pass targets — so you know at a glance who is ready for Shopify. Every already-generated ebook that hasn't been through the new gates must be pulled back through them before any upload. Any re-render must display the reason.

---

## 1. Canonical QC Gate model (single source of truth)

Add a new helper `supabase/functions/_shared/qc-gates.ts` that computes a normalized gate report from an ebook row:

```
gates = {
  formatter:  { score, pass, target: 90, breakdown: { typography, reading_comfort, table_render, worksheet_layout, premium_layout, raw_markdown } },
  reader:     { score, pass, target: 90, status, attempts, breakdown: 11 dimensions },
  cover_pdf:  { score, pass, target: 100, full_a4 },
  cover_thumb:{ score, pass, target: 90, breakdown: { book_mockup, readability, click_appeal, premium_feel } },
  overall_ready_for_shopify: boolean,
  blocking_gates: string[]
}
```

Source of truth = existing JSON columns (`pdf_qc`, `reader_experience_qc`, `cover_qc`) + scalar mirrors (`pdf_score`, `reader_experience_score`, `cover_score`). No schema change needed for scores.

## 2. DB changes (one migration)

- Add `re_render_reason TEXT`, `re_render_count INT DEFAULT 0`, `re_render_last_at TIMESTAMPTZ` on `ebooks`.
- Add `qc_ready_for_shopify BOOLEAN DEFAULT false` + `qc_gates_json JSONB` (denormalized snapshot written by pipeline on each QC pass — cheap to read from UI).
- No new tables, no RLS surprises.

## 3. Backfill / Re-QC existing ebooks

Create edge function `requeue-legacy-qc`:

1. Selects every ebook where any of these is true:
   - `reader_experience_status` is NULL or score < 90
   - `pdf_qc` missing new formatter metrics (typography/reading_comfort/premium_layout)
   - `cover_qc` missing thumbnail_book_mockup or pdf_cover_full_a4 score
   - `shopify_status` in ('none','error','failed') AND `qc_ready_for_shopify` = false
2. For each, sets:
   - `re_render_reason` = human string (e.g. "Legacy: missing Reader QC", "Cover missing full-A4 gate", "PDF missing premium formatter metrics")
   - `re_render_count` += 1, `re_render_last_at` = now()
   - `canonical_status` = 'needs_action', `pdf_status` = 'idle', `qc_ready_for_shopify` = false
   - Clears stale `shopify_status` = 'queued_for_reqc'
3. Sequential Safe Mode picks them up one at a time (no change to orchestrator needed — existing lock).

Trigger from a new "Re-QC all legacy books" button on the Production page (admin only) + one-shot invocation now.

## 4. Pipeline: write gate snapshot + block Shopify

In `autopilot-pipeline/index.ts` at the point just before `shopify_draft`:

- Import `computeQcGates()` from `_shared/qc-gates.ts`.
- Write `qc_gates_json` + `qc_ready_for_shopify` on the ebook row.
- If `overall_ready_for_shopify === false` → do NOT transition to `shopify_draft`; set `canonical_status = 'needs_action'`, populate `blocker_reason` with `blocking_gates.join(', ')`, and route back to the first failing repair loop (formatter → re-render, reader → humanize loop, cover → regenerate).
- On every re-render triggered by a failing gate, set `re_render_reason` to the failing gate name(s) and increment `re_render_count`.

## 5. `admin-data` edge function

Extend the ebook payload with:

```
qc: {
  formatter: { score, pass, target: 90 },
  reader:    { score, pass, target: 90, status, attempts },
  cover_pdf: { score, pass, target: 100 },
  cover_thumb:{ score, pass, target: 90 },
  ready_for_shopify: boolean,
  blocking_gates: string[]
},
re_render: { count, reason, last_at }
```

Computed via the shared `computeQcGates()` helper (edge functions can import from `_shared`).

## 6. UI — QC Gate Card on Production / Live Queue

New component `src/components/admin/QcGateCard.tsx` used inside `LiveProductionQueue.tsx` for every ebook row (Working On, Queued, Ready to Publish, Needs Admin):

```
┌─ QC Gates ────────────────────────────────────────────┐
│ Formatter QC   92 / 90  ✅                            │
│ Reader QC      88 / 90  ❌  (attempt 2/3, humanizing) │
│ Cover PDF     100 /100  ✅                            │
│ Cover Thumb    94 / 90  ✅                            │
│ ─────────────────────────────────────────────         │
│ Ready for Shopify: NO — blocked by Reader QC          │
└───────────────────────────────────────────────────────┘
```

Add a **"Re-rendering"** badge next to the title when `re_render_count > 0` showing the reason (e.g. `↻ Re-rendering · Reason: Legacy — missing Reader QC`). Thai labels alongside English (matching existing convention).

Add a new "🟢 พร้อมอัพขึ้น Shopify · Ready to upload" section that lists only ebooks where `qc.ready_for_shopify === true` AND `shopify_status !== 'uploaded'`.

## 7. Production page — "Re-QC legacy books" action

In `src/pages/Production.tsx` (advanced mode section), add a button that calls the new `requeue-legacy-qc` function and shows a summary toast (X books requeued, list of reasons). Confirm dialog first.

---

## Technical notes

- No changes to the existing gate thresholds — the skill already defines them. This plan surfaces + enforces what's already there.
- All updates go through Sequential Safe Mode; the global `heavy_production` lock keeps re-QC one book at a time.
- `computeQcGates()` is pure — same function used by the pipeline (write) and admin-data (read), so UI and enforcement can never drift.
- No frontend business-logic duplication; UI reads the snapshot from `admin-data`.

## Files touched

- New: `supabase/functions/_shared/qc-gates.ts`, `supabase/functions/requeue-legacy-qc/index.ts`, `src/components/admin/QcGateCard.tsx`
- Migration: add 5 columns on `ebooks`
- Edit: `supabase/functions/autopilot-pipeline/index.ts` (gate check before shopify_draft, write snapshot, set re_render_reason)
- Edit: `supabase/functions/admin-data/index.ts` (include `qc` + `re_render` in response)
- Edit: `src/lib/adminData.ts` (types), `src/components/admin/LiveProductionQueue.tsx` (render card + Ready-to-upload section), `src/pages/Production.tsx` (Re-QC button)

Uses the **premium-ebook-master** skill.
