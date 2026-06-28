# Global Auto-Fix QC System

A single, reusable auto-fix loop wired into every QC gate. Targeted fixes only, hard cap at 3 attempts per gate, then stop and flag for admin. No silent failures, no auto-publish after manual override.

## 1. Database (one migration)

Add columns to `ebooks` for gate-level tracking:

- `qc_status` text — `qc_pending | qc_passed | auto_fixing | auto_fix_failed | needs_admin_review | ready_to_continue`
- `failed_gate` text — e.g. `cover`, `thumbnail`, `chapter`, `diagram`, `shopify_upload`
- `failed_component` text — sub-id (chapter index, diagram slug, etc.)
- `failed_score` numeric, `required_score` numeric
- `auto_fix_attempt_count` int default 0
- `max_auto_fix_attempts` int default 3
- `last_auto_fix_action` text
- `auto_fix_history` jsonb default `[]`
- `admin_review_reason` text
- `next_recommended_action` text
- `blocked_at` timestamptz, `resolved_at` timestamptz

History entry shape:
```json
{ "attempt": 1, "gate": "thumbnail", "component": null,
  "reason": "score 82 < 90", "action": "rerender_thumbnail",
  "before": 82, "after": 91, "result": "pass", "at": "ISO" }
```

## 2. Shared auto-fix engine

New file `supabase/functions/_shared/autofix.ts`:

```text
runWithAutoFix({ ebookId, gate, component, run, fix, max=3 })
  → loops: run() → if pass, record + return
                → else fix() → record attempt → loop
  → after max fails: set qc_status='needs_admin_review',
    failed_gate/score, blocked_at, recommended_action
```

Every gate is wrapped through this single helper so retry/cap/history logic exists in one place.

## 3. Gate registry

`supabase/functions/_shared/qc-gates.ts` exports one entry per gate with a `check` and a targeted `fix`:

```text
idea            → rewrite title/subtitle/hook
outline         → strengthen structure, add missing sections
chapter[i]      → rewrite one chapter
final_manuscript→ fix only failed sections
cover           → adjust overlay/contrast, regenerate bg if needed
thumbnail       → rerender from final cover, bigger title, stronger gradient
chapter_divider → rewrite promise + outcome bullets only
worksheet[i]    → switch layout type, add fields
diagram[i]      → rebuild with approved component
pdf_layout      → add premium blocks, fix spacing/page breaks
product_page    → rewrite title/desc/FAQ/CTA/SEO
shopify_upload  → retry upload, verify assets
final_approval  → recurse into the specific failed sub-gate
```

Fix functions reuse existing generators (`generate-cover`, `write-chapters`, `build-pdf`, `generate-product-page`, `push-to-shopify`, etc.) — no full-ebook regen unless the failed component demands it.

## 4. Pipeline wiring

`autopilot-pipeline` and each step function call gates through `runWithAutoFix` instead of failing fast. On `needs_admin_review` the pipeline:

- stops further steps
- never sets `pdf_status='pdf_ready'`, never calls `push-to-shopify`, never flips `status='completed'`
- records the failure in `pipeline_step_logs`

## 5. Final Approval UI

`src/components/admin/FinalApproval.tsx` + new `AutoFixPanel`:

- Status banner: `Auto-fixing failed QC gate… attempt N/3` / `Auto-fixed and passed` / `Needs Admin Review`
- On `needs_admin_review`: show failed gate, score vs required, all attempt rows (action / before → after / reason), and buttons:
  - Retry Auto-Fix Once
  - Edit Manually
  - Regenerate Component
  - Reject
  - Mark Approved Manually (audit-logged; suppresses any auto-publish)

## 6. Safety rules enforced in code

- `publishGate` in `_shared/qc.ts` already blocks publish unless `pdf_status='pdf_ready'`; extend it to also require `qc_status IN ('qc_passed','ready_to_continue')` and reject when `manual_override=true` unless admin explicitly clicked Publish.
- Hard cost cap: each gate's fix is targeted; the engine refuses to call fix if `auto_fix_attempt_count >= max`.

## 7. Backfill / current ebook

After the migration, set existing rows to `qc_status='ready_to_continue'` where `pdf_status='pdf_ready'` so the current "Six-Month Debt Exit Strategy" doesn't get re-flagged.

## Technical notes

- One migration, one shared engine, one gate registry — no per-function reinvention.
- Existing functions stay intact; we only wrap their callers.
- History is append-only JSONB; no separate table needed (low row volume per ebook).
- Frontend changes confined to `FinalApproval.tsx` + a new `AutoFixPanel.tsx`.

## Out of scope (ask if you want these)

- Separate `qc_attempts` table (JSONB is enough for now).
- Per-gate cost metering beyond attempt count.
- Background worker / cron — fixes run inline in the existing edge functions.

Approve and I'll implement in this order: migration → shared engine + registry → wire into build-pdf/push-to-shopify/autopilot → FinalApproval UI → backfill.
