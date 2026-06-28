# True Hands-Off Autopilot Refactor

## Principle
Admin only intervenes when auto-fix fails 3× or a real config/error blocker exists. **No approval buttons in the normal flow.**

---

## 1. Pipeline (`autopilot-pipeline` edge function)
Refactor to a linear, non-blocking chain. Each gate uses `runWithAutoFix({ max: 3 })`:

```
idea → idea_qc → outline → outline_qc → chapters → chapter_qc
  → manuscript_qc → cover → cover_qc → thumbnail → thumbnail_qc
  → pdf → pdf_qc → product_copy → product_qc → shopify_draft_upload
  → mark "Ready to Publish"
```

Rules per gate:
- pass → continue immediately, no admin touch
- fail → targeted fix (component only), rerun QC
- 3× fail → set `qc_status='needs_admin_review'`, stop, record exact reason

Remove every `await waitForAdminApproval(...)` / `requires_admin_approval` flag in the pipeline path. Drop columns/usages: `idea_approved_by_admin`, `cover_approved_by_admin`, `pdf_approved_by_admin`, `final_approved_by_admin`. Replace reads with `qc_status` checks.

`shopify-publish` gate stays — but publish only triggers when `auto_publish=true` AND all gates pass. Draft upload is unconditional after QC pass.

---

## 2. Settings (`generation_settings`)
Add/ensure:
- `max_auto_fix_attempts` int default 3
- `shopify_draft_upload` bool default true
- `auto_publish` bool default false
- `safe_mode` bool default true (draft only)
- `advanced_mode` bool default false

---

## 3. Status model
User-facing statuses only:
`Queued | Running | Auto-Fixing | Draft Uploaded | Ready to Publish | Published | Needs Admin Attention | Failed | Rejected`

Map internal `*_qc` states → "Running" or "Auto-Fixing" in the UI layer (computed, no schema change).

---

## 4. UI

**Command Center** (`Dashboard.tsx`): Autopilot ON/OFF, daily quota, running, drafts uploaded today, needs admin, daily AI cost, `Start/Pause Autopilot`, `Generate 1 Ebook Now`, `Run Full Autopilot Test`. Remove all approve buttons.

**Production** (new `Production.tsx` or repurpose existing list): rows with simple status + actions `View | Resume | Fix | Reject` only.

**Job Detail** (`FinalApproval.tsx` → rename `JobDetail.tsx`):
- Healthy job → progress + QC report (read-only, "Auto-approved by QC" labels)
- `needs_admin_review` → **AdminNeededPanel at top**: failed gate, score vs required, attempts used, last error, what was tried, recommended action, buttons `Retry Auto-Fix Once | Edit Component | Regenerate Component | Reject`

Delete/hide components: `ApproveIdeaButton`, `ApproveCoverButton`, `ApprovePDFButton`, `FinalApproveButton`, `ApproveAndGenerate`, `LaunchSAFE`.

**Settings** page: expose the 5 autopilot toggles above. Hide debug/approval controls behind `advanced_mode`.

---

## 5. Run Full Autopilot Test
New button → invokes `autopilot-pipeline` with `test_mode=true` on one seeded idea. Returns structured report: started/completed, per-step status, auto-fix attempts, QC scores, Shopify draft URL, blocker (if any).

---

## Technical notes
- Reuse existing `_shared/autofix.ts` and `_shared/qc-gates.ts` registry (already 3-attempt capped, targeted fixes).
- No DB schema break: keep approval columns nullable, just stop reading them. Add `is_advanced_mode`, `auto_publish` to `generation_settings` if missing.
- `publishGate` (`_shared/qc.ts`) stops requiring `admin_approved=true`; requires `qc_status IN ('qc_passed','ready_to_continue')` only.
- Files touched: `supabase/functions/autopilot-pipeline/index.ts`, `_shared/qc.ts`, `shopify-publish/index.ts`, `src/pages/admin/Dashboard.tsx`, `src/pages/admin/Production.tsx` (new), `src/components/admin/FinalApproval.tsx` → `JobDetail.tsx`, `src/components/admin/AdminNeededPanel.tsx` (new), `src/pages/admin/Settings.tsx`, plus deletion of approve-button components.

---

## Out of scope
- No changes to PDF generation logic, QC scoring formulas, or Shopify product schema.
- No auto-publish behavior change (stays OFF by default).

Approve to proceed?