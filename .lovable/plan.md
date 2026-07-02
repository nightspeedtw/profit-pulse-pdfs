
# Premium PDF Upgrade — Plan

Two deliverables, one code path:

1. **Permanent pipeline upgrade** so every future ebook renders with safe worksheet tables, smart inside illustrations, low visual fatigue, and compliant finance wording.
2. **One-off re-render** of *The Six-Month Debt Exit Strategy* using the upgraded pipeline (no manuscript rewrite — only layout, worksheets, visuals, and wording touch-ups).

Phase 1 stability is preserved: no SEO/blog/keyword work. The pipeline order (idea → outline → chapters → manuscript QC → cover → PDF → Shopify draft) does not change; we only strengthen the PDF-layout, illustration, and compliance stages.

---

## Part A — Pipeline upgrade (permanent)

### 1. Worksheet layout hardening (`_shared/pdf-template.ts`)
- Auto-shrink & wrap logic for worksheet table headers:
  - Multi-line header cells (max 2 lines), auto-hyphenate long tokens.
  - Font-size step-down: 11pt → 9.5pt → 8.5pt if any cell overflows.
  - Column-width solver: allocate width proportional to `max(header, sample cell)` length; long-label columns get ≥1.3× base width.
  - If total width > page width at 8.5pt, split table across 2 pages (repeat header on page 2) or switch that single sheet to landscape.
- Header dictionary of safe short forms (`CURRENT EXACT BALANCE` → `Exact\nBalance`, `MINIMUM MONTHLY PAYMENT` → `Min.\nPayment`, etc.) applied automatically.
- Per-worksheet layout picker by type: `debt_tracker`, `negotiation_script`, `sprint_timeline`, `velocity_calculator`, `automation_flow`, `resilience_scorecard`, `operating_manual`. Each has its own template (table / call-log / timeline / calculator / flowchart / scorecard / checklist).

### 2. Inside-illustration planner (new `_shared/illustration-planner.ts`)
For each chapter, produce `inside_illustration_plan_json`:
```
{
  chapter_index, topic, buyer_pain, framework, worksheet_type,
  text_density_score,
  recommendation: "none" | "conceptual" | "infographic" | "timeline"
                | "process_map" | "before_after" | "decision_tree"
                | "cashflow_map" | "calculator_visual" | "system_diagram",
  placement_hint, caption
}
```
Rules baked in:
- Max 1–2 illustrations per chapter.
- Only when chapter has 3+ consecutive text-heavy pages.
- Must be topic-specific (rejected if caption ≈ generic).
- AI image prompt is **generated with "no text, no words, no letters"**; all labels are rendered as HTML/SVG overlay in the PDF template.
- Rejects stock-photo people, fake charts, misleading claim visuals via prompt guardrails + a post-gen vision QC.

### 3. Inside-illustration renderer (`_shared/pdf-template.ts` + `generate-interior-visuals`)
- New illustration slot rendered as a bordered image + SVG overlay (title, arrows, mini legend).
- Extends existing `generate-interior-visuals` edge function: adds `mode: "inside_illustrations"` that consumes the plan and stores images in `ebook-assets` bucket keyed by chapter.

### 4. New QC gates (`_shared/pdf-qc.ts` + `render-pdf`)
Adds four scores to the PDF QC report:
- `worksheet_table_overflow_score` (must be 100)
- `worksheet_readability_score` (≥90)
- `visual_fatigue_score` (≥90) — computed by walking rendered pages: fails if >3 consecutive text-only pages.
- `inside_illustration_relevance_score` (≥90) — vision-check illustration vs chapter title + topic keywords.
- `compliance_safety_score` (≥90) — see part 5.

Auto-fix chain on failure:
1. `worksheet_*` fail → re-layout worksheet (shrink font → split → landscape) and re-render only that page range.
2. `visual_fatigue` fail → planner adds one more illustration/callout in the offending stretch and re-renders.
3. `illustration_relevance` fail → regenerate the specific image with tightened prompt.
4. Up to 3 attempts per failed gate, matching existing auto-fix pattern.

### 5. Compliance linter (new `_shared/compliance.ts`)
Regex + LLM pass over final manuscript & product copy:
- Flag: `guaranteed`, `will save`, `will eliminate`, `must result`, `success rate over N%`, `accelerate … by at least N%`, `risk-free`.
- Rewrite to safer educational language (`may help`, `is designed to help`, `results depend on…`).
- Emits `compliance_safety_score` and rewrites in place, keeps disclaimer page.
- Runs as a QC pass after manuscript QC and again on product copy before Shopify upload.

### 6. Schema
Migration adds to `ebooks`:
- `inside_illustration_plan_json jsonb`
- `visual_fatigue_score int`
- `inside_illustration_relevance_score int`
- `text_density_score int`
- `worksheet_table_overflow_score int`
- `worksheet_readability_score int`
- `compliance_safety_score int` (if not already present)

### 7. Live status
Each new stage emits `current_action_message` + `current_subtask` via the existing `RunTracker.heartbeat` so the Overview shows "Rendering premium PDF… ↳ Fitting worksheet 3 of 7", "Generating inside illustration 2 of 9 (cash-flow map)", "Running compliance linter…".

---

## Part B — One-off: Six-Month Debt Exit Strategy

1. Locate the ebook record for this title in `ebooks`; if not present, ingest the uploaded PDF only as reference (do not touch the manuscript).
2. Re-run **only these steps** via a targeted invocation:
   - Compliance linter over existing chapters and product copy.
   - Illustration planner + generator (max 1–2 per chapter, matching the chapter list in the request).
   - PDF layout re-render with the new worksheet engine.
   - New QC gates; auto-fix up to 3 times per gate.
3. Do **not** rerun idea/outline/chapter/manuscript QC.
4. If all gates ≥ threshold → mark `pdf_status = ready` and push to Shopify draft (using existing `shopify-draft-upload` — no changes there).
5. Deliver: new PDF URL, list of fixed worksheets, before/after previews for 2 worksheets, list of illustrations added, 3 illustration previews, compliance rewrites diff, and the final QC report.

---

## Order of work

1. Migration (new score columns + `inside_illustration_plan_json`).
2. Compliance linter + wire into pipeline.
3. Worksheet overflow fixer in `pdf-template.ts`.
4. Illustration planner + extend `generate-interior-visuals`.
5. New QC gates + auto-fix routing.
6. Live-status heartbeats.
7. Trigger targeted re-render for the Debt Exit Strategy ebook and deliver artifacts.

## What I will NOT touch
- Manuscript content (no chapter rewrites).
- Idea / outline / chapter QC steps.
- Cover generation.
- Shopify upload logic (already stable).
- Any Phase 2 SEO/blog/keyword code.

---

## Confirm before I start

- OK to run this end-to-end as one pass, or would you rather I ship the pipeline first, then trigger the Debt Exit re-render in a second turn once you've reviewed the code?
- The QC autopass thresholds above (90 / 90 / 100 / 90 / 90) match your spec exactly. Change any of them before I lock them in?
- Illustration model: default to `google/gemini-3.1-flash-image` (Nano Banana 2 — fast, high quality, "no text" prompts behave well). OK, or prefer `openai/gpt-image-2`?
