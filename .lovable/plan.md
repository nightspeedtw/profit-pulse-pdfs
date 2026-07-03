# Premium PDF Quality Fix Plan

Goal: Make every ebook meet premium-sellable QC before it can reach `ready_to_publish`. Fix 3 current books and prevent recurrence via hard gates.

## 1. Markdown Table Rendering (`_shared/pdf-template.ts`)
- Pre-render pass: detect GFM pipe tables (header row + `:---` separator) inside chapter prose and convert to `<table class="md-table">` with `<thead>/<tbody>`, wrapping cells and forcing header wrap via soft-hyphens.
- Add CSS: bordered rows, `table-layout: fixed`, `word-break: break-word`, `page-break-inside: auto`, header repeat on new pages (`thead { display: table-header-group }`).
- Strip any residual `|...|...|` lines from prose after conversion.

## 2. Worksheet Relevance Classifier (`_shared/category.ts` + `render-pdf`)
- Extend `classifyEbook` — already exists. Tighten `ALLOWED` map:
  - Remove `debt_tracker` from productivity/energy/wellness/other.
  - Add category-specific kinds: `focus_audit`, `interruption_log`, `deep_work_planner`, `energy_audit`, `caffeine_log`, `sleep_anchor`, `crash_diagnostic`, `evening_recovery`, `cashflow_surplus`, `fortress_audit`, `lifestyle_leak`, `safety_net`, `fixed_cost_scan`.
- Register templates for each new kind in `pdf-template.ts`.
- `pickWorksheetKind`: also inspect chapter title — only allow `debt_tracker` when chapter text/title mentions debt keywords.

## 3. Placeholder Chapter Titles (`write-chapters` + `render-pdf`)
- Add `validateChapterTitle(title, index, siblings, outline)` shared helper:
  - Reject `/^chapter\s*\d+\.?\s*$/i`, `/^chapter\s*\d+\.\s*chapter\s*\d+/i`, empty, duplicate, or mismatched-with-outline.
- On failure in pipeline: regenerate title from outline brief; propagate to TOC, divider, header, running header.

## 4. Visual Relevance QC (`_shared/illustration-planner.ts`)
- Tag every planned illustration with `domain` (finance/health/productivity/etc.) derived from `classifyEbook`.
- Reject captions containing cross-domain terms (debt in productivity, etc.).
- AI images: ensure prompt says "no text, no letters, no numbers".

## 5. Category Compliance (`_shared/compliance.ts`)
- Extend `lintCompliance(text, category)`:
  - `energy_health` / `wellness`: append medical disclaimer to disclaimer page; rewrite "cure/diagnose/fix fatigue" → "may help support".
  - `finance_*`: add financial disclaimer + "results vary".
  - `productivity/business`: soften income/growth guarantees.
- Insert disclaimer block into disclaimer page automatically based on category.
- Score: `category_compliance_score` and count `high_risk_claims`.

## 6. Hard-Gate QC (`_shared/pdf-qc.ts` + `autopilot-pipeline`)
Add scores:
- `markdown_table_raw_text_score` (100 required — regex scan of body)
- `table_render_quality_score` (>=90)
- `table_overflow_score` (100 — extend existing overflow heuristic to `md-table`)
- `worksheet_relevance_score` (>=95 — checks kind vs category+chapter)
- `wrong_template_score` (=0)
- `chapter_title_quality_score` (>=90)
- `no_placeholder_chapter_titles` (bool)
- `inside_visual_relevance_score` (>=90)
- `visual_label_match_score` (>=95)
- `category_compliance_score` (>=90)
- `final_premium_sellable_score` (>=90 combined)

Pipeline: if any gate fails → route to `pdf_needs_repair`, run targeted fix (3 attempts), re-render, re-QC. Never `ready_to_publish` until all pass.

## 7. Fix Current 3 Books
Trigger re-render for:
- **Uninterrupted Workday Protocol** — swap Debt Tracker → Focus-to-Friction Audit + Interruption Origin Log + Deep Work Deficit Calculator + Office Hours Boundary Planner. Rename placeholder "Chapter 2" → "The Biological Prime Time Map". Convert md tables. Add relevant visuals.
- **Deep Energy Protocol** — swap Debt Forensic Dashboard → 72-Hour Energy Audit, Caffeine Half-Life Log, Energy Leakage Diagnostic, 2 PM Crash Worksheet, Evening Recovery Tracker. Compliance-safe supplement chapter.
- **Financial Fortress Blueprint** — Fortress Baseline Audit, Cash Flow Surplus Calc, Lifestyle Leak Matrix, Safety Net Builder, Fixed Cost Fragility Scan. Keep debt worksheet only in debt-specific chapters. Fix "Quartery" typo. Convert md tables.

## Files Touched
- `supabase/functions/_shared/pdf-template.ts` (md-table converter + new worksheet templates + CSS)
- `supabase/functions/_shared/category.ts` (tighter ALLOWED, new kinds)
- `supabase/functions/_shared/pdf-qc.ts` (new scores + hard gates)
- `supabase/functions/_shared/compliance.ts` (category-aware + disclaimers)
- `supabase/functions/_shared/illustration-planner.ts` (domain tagging)
- New: `supabase/functions/_shared/chapter-title-guard.ts`
- `supabase/functions/render-pdf/index.ts` (wire md-table conversion, title validation, category compliance)
- `supabase/functions/write-chapters/index.ts` (title validation on write)
- `supabase/functions/autopilot-pipeline/index.ts` (hard-gate routing + retry loop)
- Data ops: set the 3 target ebooks back to `needs_review` with `pdf_repair` flag and re-run render.

## Order of Execution
1. Ship shared helpers (category, template, qc, compliance, title-guard, illustration).
2. Wire `render-pdf` + `write-chapters` + `autopilot-pipeline`.
3. Trigger re-render for the 3 books.
4. Re-QC and verify all hard gates pass before allowing 100%.

No Shopify upload until every gate passes.
