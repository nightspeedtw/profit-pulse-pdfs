## Diagnosis

The stuck gates have two separate root causes:

1. **cover_pdf gate is reading the wrong producer output**
   - `qc-gates.ts` expects full-A4 scores in `ebooks.cover_qc` as `pdf_cover_full_a4_score` / `cover_full_bleed_score`.
   - The producer currently writes those scores to `ebooks.pdf_qc` from `render-pdf`.
   - For **The Financial Fortress Blueprint**, `pdf_qc.cover_full_a4_score = 100` and `pdf_qc.cover_full_bleed_score = 100`, but `cover_qc` has no A4 fields, so the UI/gate can still report `cover_pdf` as missing/failing.
   - The fix is not a threshold change; it is to align the gate with the actual producer output and optionally mirror the value for future rows.

2. **reader gate retries do not converge because repairs are too small and stop after 3 global attempts**
   - Current Reader QC only rewrites up to **2 excerpts per invocation**, and because the latest book is already at `reader_experience_fix_count = 3`, it ends as `needs_review` instead of continuing a producer-level repair.
   - The failing reasons show manuscript-wide tone/structure problems: formulaic “protocol/framework/architecture” language, repeated salary range, repeated chapter closings, raw markdown heading artifacts, and duplicated headings.
   - A surgical excerpt-only rewrite cannot reliably fix that kind of systemic prose pattern.
   - The producer needs a deterministic manuscript-level cleanup plus stronger targeted humanization, then re-score.

## Implementation Plan

### 1. Fix `cover_pdf` score source alignment

- Update `supabase/functions/_shared/qc-gates.ts` so `cover_pdf` first reads:
  - `pdf_qc.pdf_cover_full_a4_score`
  - `pdf_qc.cover_full_a4_score`
  - `pdf_qc.cover_full_bleed_score`
  - then falls back to existing `cover_qc` keys for backward compatibility.
- Set `cover_pdf.pass` only when the resolved score is exactly `100`, preserving the premium contract.
- Update `coverPdfHasData` to use the same resolved score, not unrelated `cover_score`.

### 2. Mirror A4 cover QC from `render-pdf` for future compatibility

- In `supabase/functions/render-pdf/index.ts`, when saving `pdf_qc`, also merge these fields into `cover_qc`:
  - `pdf_cover_full_a4_score: coverA4`
  - `cover_full_bleed_score: coverFullBleedScore`
  - `cover_pdf_checked_at`
- Preserve existing cover QC fields such as thumbnail and design scores.
- This prevents future UI/gate drift even if another component reads from `cover_qc`.

### 3. Add deterministic reader cleanup before AI scoring

In `supabase/functions/reader-experience-qc/index.ts`:

- Add a preflight cleanup pass that scans all chapters and fixes manuscript-wide issues before the critic runs:
  - Strip raw leading markdown headings that duplicate chapter titles.
  - Convert bold-only pseudo-headings like `**The Debt Ceiling Protocol...**` into clean prose/heading-safe text.
  - Reduce repeated target salary phrase variants after first use.
  - Replace overused finance-engineering jargon clusters (`protocol`, `framework`, `architecture`, `infrastructure`, `fortress`, etc.) when repeated excessively.
  - Remove or vary formulaic chapter closings/openers when repeated.
- Save cleaned chapter content and updated word counts before scoring.
- Log cleanup counts into `reader_experience_qc.history` for transparency.

### 4. Strengthen targeted humanization so retries can converge

- Increase repair coverage per invocation while still staying under Edge limits:
  - Keep one score+repair cycle per invocation.
  - Rewrite up to 4 short flagged excerpts total instead of 2.
  - Prioritize repeated/canned/systemic excerpts first.
- Add deterministic fallback rewrite for known patterns when the AI rewrite call fails, so “0 replacements” does not prematurely stop repairs.
- Persist a structured repair summary:
  - `systemic_cleanup_applied`
  - `chapters_touched`
  - `replacements`
  - `remaining_failed_keys`

### 5. Let Reader QC continue after producer-level repairs, but still cap true failures

- Treat `reader_experience_fix_count >= 3` as exhausted only when no deterministic cleanup or targeted replacements were made.
- If cleanup/replacements were made, set `reader_experience_status = auto_retry`, `autopilot_state = waiting_for_worker_slot`, and schedule `next_retry_at` so the worker can re-score the improved manuscript.
- If no repair is possible after cleanup and targeted attempts, keep `needs_review` with exact failed keys and excerpts.

### 6. Acceptance checks

- For **The Financial Fortress Blueprint**:
  - `cover_pdf` resolves to score `100` from `pdf_qc` and no longer blocks.
  - Reader QC performs a real producer repair instead of repeating the same no-op retry.
  - The book either advances to retry/re-score automatically or, if still blocked, shows exact remaining reader issues rather than generic failure.
- No QC threshold is lowered.