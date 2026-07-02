
# Premium PDF Hard-QC & Cover Full-Bleed Fix

Goal: every ebook PDF passes strict QC before Shopify. Cover is true full-A4 bleed. Failed gates auto-repair the specific component and re-render, up to 3 attempts, then Needs Admin.

## 1. Full-bleed cover (root fix)

**File:** `supabase/functions/_shared/pdf-template.ts`

- Add dedicated `.cover-page` template separated from article pages:
  - `@page cover { size: A4; margin: 0 }` + `.cover-page { page: cover; width: 210mm; height: 297mm; margin: 0; padding: 0; position: relative; overflow: hidden; page-break-after: always; }`
  - `.cover-background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }`
  - `.cover-overlay { position: absolute; inset: 0; z-index: 2; padding: 18mm; }` (safe area)
- Remove any header/footer/page-number injection on page 1 (Chromium `displayHeaderFooter` still on, but cover uses `@page cover { @top-left {content:none} ... }` and we pass `pageRanges` logic or a blank template for cover).
- Ensure the composed cover PNG (from `_shared/cover.ts`) is embedded as `<img class="cover-background">` not as a decorative inline block.

**File:** `supabase/functions/build-pdf/index.ts` / `render-pdf/index.ts`
- Pass Chromium `margin: {top:0,right:0,bottom:0,left:0}` and rely on per-page `@page` rules for interior margins. Header/footer templates must be empty strings for page 1 (use `<span class="pageNumber"></span>` conditional via CSS `@page:first`).

## 2. Cover Full-Bleed QC gate

**New:** `supabase/functions/_shared/cover-fullbleed-qc.ts`

- Rasterize page 1 to PNG via Browserless `screenshot` of the PDF (or reuse existing thumbnail render at 210x297mm).
- Score `cover_full_bleed_score` (0/100 hard):
  - Sample 40px border strip on all 4 edges; if >2% near-white pixels → fail.
  - Sample bottom 8% row; if avg luminance near paper white → fail (blank bottom).
  - Verify image dims == expected A4 aspect (±1%).
  - Check safe-area: title/subtitle bounding boxes (from SVG spec) inside 15mm inset.
- Return `{ score, reasons[] }`. Gate: must equal 100.

**Repair hook:** on fail → rebuild via `generate-cover` with `layout_variant='full_bleed_v2'`, re-render, re-screenshot, re-QC. Max 3.

## 3. Raw markdown table killer

**New:** `supabase/functions/_shared/markdown-tables.ts`
- `convertMarkdownTablesToHtml(md)`: regex-detect `| ... |` + `| :--- |` header lines; emit `<table class="pdf-table">…</table>` with `<thead>`, `<tbody>`, cell wrap, `word-break`, and column-count split when >6 cols.
- Called inside `write-chapters` (before persisting HTML) AND as a safety pass inside `pdf-template.ts` right before serialization.

**QC in `_shared/pdf-qc.ts`:**
- `raw_markdown_score`: 100 if no `/^\s*\|.*\|\s*$/m` or `:---` remains in final HTML body. Hard fail.
- `table_render_quality_score`: check each `<table>` has `<thead>`, `<th>` count matches `<td>` count per row, all cells non-empty.
- `table_overflow_score`: reuse existing `worksheetOverflowScore` extended to all tables.

## 4. Worksheet relevance classifier

**New:** `supabase/functions/_shared/worksheet-registry.ts`
- Registry: `{ category → allowedWorksheetIds[] }` for the 11 categories listed.
- Worksheet catalog per category (Focus Audit, Interruption Log, 72h Energy Audit, Caffeine Half-Life, Fortress Baseline Audit, Cash Flow Surplus, Lifestyle Leak Matrix, Debt Ceiling Protocol, etc.).
- `classifyEbookCategory(ebook)`: LLM-lite via title/subtitle + keyword rules; store on `ebooks.category_classified`.
- `pickWorksheet(category, chapterTopic)`: returns worksheet template id + fields.

**Integrate:** `generate-outline` and `write-chapters` request worksheets by id from registry; refuse Debt Tracker unless `category==finance_debt` OR chapter tag `debt_specific`.

**QC:**
- `worksheet_relevance_score` ≥95, `wrong_template_score` = 0, `category_match_score` ≥95.
- Fail → regenerate offending worksheet only, patch chapter, re-render.

## 5. Chapter title validation

**New:** `supabase/functions/_shared/chapter-title-qc.ts`
- Fail patterns: `/^chapter\s*\d+\.?$/i`, `/^chapter\s*\d+\.\s*chapter\s*\d+/i`, empty, duplicates, exact matches to outline placeholders.
- On fail: regenerate that chapter title via AI, cascade update to outline JSON, TOC, chapter divider, running headers, then re-render.
- `no_placeholder_chapter_titles=true` gate.

## 6. Visual relevance QC

**Update:** `supabase/functions/_shared/illustration-planner.ts`
- Tag every planned figure with `{domain, chapterId, labelKeywords[]}`. Reject cross-domain (e.g. `domain=debt` in `category=productivity`).
- QC `inside_visual_relevance_score` ≥90: for each `<figure class="inside-illus">`, caption keywords must overlap chapter title tokens ≥1 AND domain must match ebook category.

## 7. Category compliance QC

**New:** `supabase/functions/_shared/compliance-category.ts`
- Rulesets: health/energy → require medical disclaimer, ban "cure/guaranteed/diagnose"; finance → require disclaimer + "results vary", ban "guaranteed savings/income"; productivity → ban "guaranteed growth".
- Scan full manuscript HTML; return `category_compliance_score` and `high_risk_claims` count. Auto-inject missing disclaimers on cover-back / copyright page; rewrite offending sentences via AI.

## 8. Screenshot-based visual QC

**New:** `supabase/functions/_shared/pdf-screenshot-qc.ts`
- After PDF render, screenshot pages: 1 (cover), 2 (title), TOC, first chapter divider, first article, first worksheet, first illustration, one middle random page. Use Browserless PDF→PNG.
- Run per-page checks: white-border detection, cropped-text (edge text bbox within margin), raw-markdown regex on extracted text (pdftotext via pdf.js in edge is heavy — instead parse the HTML we sent, not the PDF).

## 9. Auto-repair orchestration

**Update:** `supabase/functions/autopilot-pipeline/index.ts`
- New step `pdf_qc` runs consolidated QC returning `failed_gates[]`.
- Repair map (cover_fullbleed→rebuild cover template, raw_markdown→re-run markdown converter+re-render, worksheet_wrong→regenerate worksheet, chapter_title→regenerate+cascade, visual_mismatch→regenerate figure, table_overflow→wrap/split, compliance→inject/rewrite).
- Loop max 3 per gate; then `needs_admin` with structured reason.
- Status labels in Thai/English: "Auto-fixing cover full-bleed — attempt 1/3" etc., surfaced to `LiveProductionQueue`.

## 10. Shopify gate

**Update:** `supabase/functions/autopilot-pipeline/index.ts` before `shopify_draft`:
```
require all: cover_full_bleed_score==100, cover_score>=90, thumbnail_score>=90,
content_score>=90, chapter_title_quality_score>=90, worksheet_relevance_score>=95,
table_render_quality_score>=90, table_overflow_score==100, raw_markdown_score==100,
inside_visual_relevance_score>=90, visual_fatigue_score>=90,
category_compliance_score>=90, final_premium_sellable_score>=90
```
If any fail → stay in `ready_to_publish=false`, route back into repair loop.

## 11. Fix the 3 existing ebooks

One-shot admin action `pipeline-repair` that, for the 3 named ebook ids:
1. Reclassify category (Uninterrupted Workday→productivity, Deep Energy→energy_health, Financial Fortress→finance_cashflow).
2. Regenerate worksheets from correct registry set.
3. Regenerate "Chapter 2" placeholder titles in Uninterrupted Workday.
4. Fix typo "Quartery Checks"→"Quarterly Checks" globally.
5. Rebuild cover with full-bleed template.
6. Re-render PDF + run full QC.

Trigger via new "Repair PDF" button on the Ready-to-Publish cards.

## 12. Database

Migration adds columns to `ebooks`:
- `category_classified text`
- `pdf_qc_json jsonb` (all scores + failed_gates + attempts per gate)
- `cover_full_bleed_score int`
- `pdf_repair_attempts jsonb` (per-gate counter)

Grants: `authenticated` SELECT/UPDATE, `service_role` ALL.

## Technical notes

- Chromium PDF: use per-page `@page` selectors + `pageRanges` is not needed; cover uses named page `@page cover` and `.cover-page{page:cover}`. Header/footer template returns empty for page 1 by checking `.pageNumber` CSS `@page cover { @bottom-right { content: none } }` — since Chromium's `headerTemplate` is global, we instead render page number *in HTML* per non-cover page and pass empty header/footer templates.
- Screenshot QC uses existing Browserless token.
- All new QC modules pure functions → unit-testable.

## Out of scope

- No SEO work.
- No Shopify upload changes beyond adding gate checks.
- No changes to idea/title generation.
