## Phase 1 Cleanup — PDF-Only Autopilot

Goal: strip the codebase to a single canonical PDF pipeline, gate Shopify/SEO/blog behind a feature-flag file, and keep the app buildable at every step.

### 1. Feature flags (new)
Create `src/config/features.ts` and `supabase/functions/_shared/features.ts` with:
```
PHASE_1_PDF_ONLY: true
SHOPIFY_UPLOAD: false
SEO_AUTOMATION: false
BLOG_AUTOMATION: false
SOCIAL_POSTING: false
ADVANCED_BATCH_MODE: false
```
All disabled call-sites read from this file (no env-var requirement).

### 2. Audit (produced as JSON in final reply)
Walk `supabase/functions/`, `src/pages/`, `src/components/**`, and `package.json`. Classify each item into the required inventory shape (active / probably_unused / duplicate / legacy / safe_to_delete / archive / do_not_touch). No deletions before the inventory is written to `/mnt/documents/phase1-cleanup-inventory.json`.

### 3. Canonical pipeline (keep)
Edge functions kept active:
- autopilot-pipeline, autopilot-recovery-worker, autopilot-doctor, preflight-check
- premium-title-expert, generate-idea, generate-outline, write-chapters
- final-manuscript-qc, reader-experience-qc
- generate-cover, render-pdf, qc-check, qc-fix, autofix-action
- admin-data, resume-generation, download-pdf, customer-download-pdf

### 4. Isolate for Phase 1 (feature-flag, don't delete)
- push-to-shopify, shopify-draft-upload, shopify-publish, shopify-test-connection, generate-shopify-package, compute-pricing, promote-idea
- Guard every caller with `FEATURES.SHOPIFY_UPLOAD`. Preflight no longer errors when Shopify secrets are absent.
- UI: hide `ShopifyStatus`, `ReadyShopifyCard`, `PricingPanel`, Shopify buttons in `LiveProductionQueue`, `FinalApproval`, `AutopilotStatusCenter` behind the flag.

### 5. Archive (move to `supabase/functions/_archive/` + `src/_archive/`)
Candidates flagged as unused after grep confirms zero live imports:
- autopilot-orchestrator (superseded by autopilot-pipeline)
- build-pdf, test-sample-pdf, worksheet-preview (legacy render paths)
- generate-alternatives, improve-idea, idea-copywriter, premium-positioning, generate-interior-visuals (Phase 2 experiments)
- requeue-legacy-qc, daily-cron (one-shot maintenance)
- UI: `PdfWizard`, `WorksheetOverflowReview`, `AutoFixPanel` (if duplicated by `AutoFixChip` + doctor)

Only archived after `rg` confirms no active caller. Anything referenced stays put.

### 6. Duplicate pipeline consolidation
Search for duplicate `startAutopilot / runAutopilot / generateEbook / resumePipeline / fixAll / runRecovery / generatePdf / renderPdf / generateCover / readerQc`. Route every caller to the canonical implementation, delete the losing copy.

### 7. Fix All behavior
Replace blind Fix All in `LiveProductionQueue` with:
- Fix Current Step, Resume Pipeline, Run Doctor, Recover Missing Data, Recompute QC Gates.
Recovery worker already has repair-fingerprint escalation — reuse and enforce 2-attempt no-change → `needs_code_fix`.

### 8. Table references
Confirmed canonical: `ebooks`, `autopilot_pipeline_runs`, `autopilot_pipeline_steps`, `production_queue`, `qc_reports`, `ebook_assets`, `shopify_upload_queue` (Phase 2). No `ebook_jobs / old_jobs / product_jobs / legacy_autopilot_jobs` exist. Nothing to migrate.

### 9. Dependency cleanup
Only remove npm packages that `rg` proves are unimported after archiving. Conservative — skip if in doubt.

### 10. Acceptance
- `bun run build` clean
- `tsgo` clean
- Preflight passes with Shopify token deliberately unset
- One-Click Autopilot reaches `final_pdf_ready`
- No route reads archived files

### Deliverables
- `phase1-cleanup-inventory.json` (audit)
- Feature-flag file + guarded call-sites
- Archived duplicates in `_archive/`
- Simplified admin UI
- Final JSON report as specified

### Out of scope
- No schema migrations (canonical tables already correct)
- No Shopify/SEO/blog code deletion — only flag-gating and archival
- No changes to `src/integrations/supabase/client.ts` or auto-generated files