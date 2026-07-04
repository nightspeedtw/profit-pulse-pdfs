# Phase 2 Launch Batch — 8 new ebooks (1 per category) with topic-matched illustrations

## Goal
Ship 1 additional premium ebook per active category (8 total), each with:
- A cover whose **mood** matches the content (serious / playful / warm / artistic — not one template).
- **Interior illustrations that match the actual topic** of each chapter (food photos in Cooking, exercise imagery in Fitness, study desks in Study & Exam, etc.).
- All existing QC gates still enforced (reader QC, PDF A4 cover, thumbnail mockup, uniqueness DNA).

## Books to generate

| # | Category | Working title | Cover mood | Illustration theme |
|---|---|---|---|---|
| 1 | Study & Exam | The Memory Lab: 30-Day Recall System | Serious / academic calm | Study desks, flashcards, timelines |
| 2 | Business & Templates | The One-Page Business Machine | Confident / editorial | Dashboards, templates, meeting scenes |
| 3 | Wellness & Mind | The Quiet Mind Reset | Warm / soft / hopeful | Breathwork, journaling, morning light |
| 4 | Fitness & Meal Plans | The Strong Base: 8-Week Home Strength Plan | Bold / athletic | Bodyweight moves, dumbbells, meal plates |
| 5 | Parenting & Kids | Small Wins: The Calm Parenting Playbook | Playful / warm | Family scenes, kid activities, routines |
| 6 | Lifestyle & Planners | The Signature Week Planner | Elegant / lifestyle | Planner spreads, morning rituals, desks |
| 7 | Art & Creative | The Daily Studio: Creative Momentum in 20 Minutes | Artistic / expressive | Sketchbooks, brushes, studio corners |
| 8 | Cooking & Recipes | The 20-Minute Weeknight Kitchen | Appetizing / warm | Finished dishes, ingredients flat-lay |

## Cover direction (per book)
- Feed each book's category + mood + metaphor into the existing Design DNA engine so the 9-axis uniqueness signature stays diverse vs already-shipped covers.
- Mood tag drives palette + typography family:
  - serious → serif display, muted palette
  - playful → rounded sans, warm bright accent
  - artistic → hand-drawn/painterly medium, expressive accent
  - appetizing → warm neutrals + food-forward still life
- Textless AI background + app-side typography overlay (existing world-class cover rules).

## Interior illustrations (new work)
Currently chapters are text-only. Add a **topic-matched illustration per chapter** using the AI Gateway image endpoint.

Approach:
1. Extend the chapter generation step to also emit an `illustration_prompt` per chapter, derived from the chapter topic + book's illustration theme (e.g. Cooking chapter "Sheet-Pan Chicken" → "overhead flat-lay of a roasted sheet-pan chicken with lemon and vegetables, warm daylight, editorial food photography, no text").
2. Add a new pipeline step `chapter-illustrations` after `manuscript_qc` and before `reader-experience-qc`:
   - Generates 1 image per chapter via `openai/gpt-image-2` (or Gemini image for food/lifestyle warmth).
   - Uploads to `ebook-covers` bucket (or a new `ebook-illustrations` bucket).
   - Persists `illustration_url` on `ebook_chapters`.
3. Update `pdf-template.ts` to render `<figure>` with the illustration at the top of each chapter body (below the chapter title, above the drop-cap paragraph), with a soft caption style. Keeps existing typography/QC gates intact.
4. Add QC gate `illustration_topic_match_score ≥ 85` (AI critic checks that image matches chapter topic). Fail → regenerate with sharper prompt (max 2 retries).

## Run order
- Sequential (one book at a time), because orchestrator + image gen + PDF render are heavy.
- Kick off Book 1 via `POST /autopilot-orchestrator` in `safe` mode; subsequent books auto-queue when previous reaches `ready_for_shopify` / `final_report`.
- After 3 failed auto-fix attempts on any single book → mark `needs_admin_attention`, continue to next.

## Technical changes required

1. `supabase/functions/_shared/pdf-template.ts` — add `<figure class="chapter-illustration">` block + print-safe CSS (max-width, no page-break inside figure).
2. `supabase/functions/generate-chapters/index.ts` (or equivalent) — emit `illustration_prompt` per chapter.
3. New edge function `supabase/functions/generate-chapter-illustrations/index.ts` — batch generate + upload + persist.
4. `supabase/functions/autopilot-orchestrator/index.ts` — insert new step between `manuscript_qc` and `reader-experience-qc`.
5. `supabase/functions/_shared/qc-gates.ts` — add `illustration_topic_match_score` gate.
6. Migration: add `illustration_url TEXT`, `illustration_prompt TEXT`, `illustration_qc JSONB` to `ebook_chapters` (+ GRANTs).
7. Seed 8 rows in `ebook_ideas` with the titles + moods + illustration themes above.
8. No changes to Shopify upload, pricing, or thumbnail engine — those stay as-is.

## Deliverable / final report
For each of the 8 books:
- title, category, mood, illustration theme
- final PDF URL, cover URL, thumbnail URL
- QC scores (reader, PDF cover A4, thumbnail mockup, illustration match, diversity)
- suggested price
- blockers (if `needs_admin_attention`)

## Confirmation before I build
1. OK to add per-chapter illustrations (adds image-gen cost per chapter, ~10 images/book × 8 books ≈ 80 images this batch)?
2. OK with the 8 working titles above, or want to swap any?
3. Run sequentially in background (safe, slower) or parallel 2-at-a-time (faster, more load)?
