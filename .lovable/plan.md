# Children Picture Book Autopilot — Production Upgrade

Goal: fix cover quality/consistency, add a real admin control, and produce one new picture book that either publishes live to the Internal Store or lands in `human_review_required` with exact reasons — never a soft-pass.

## 1. Inspection first (no edits until this is done)

Read and report the current wiring for each responsibility so we extend, not replace:

- Autopilot start → `autopilot-kids-orchestrator`, `autopilot-kids-pipeline`, `autopilot-kids` (older adult-guarded shim)
- Category selection & weights → `kids_category_weights`, `kids_age_groups`, `kids_themes`, `kids-recompute-weights`
- Story/manuscript → `rewrite-kids-manuscript`, `_shared/prompts/kids.ts`
- Cover generation → `generate-cover`, `_shared/covers/kids-cover-render.ts`, `_shared/fal.ts`, `_shared/cover.ts`
- Interior illustrations → `_shared/kids-visual-bible.ts`, `_shared/illustration-planner.ts`, `render-pdf`
- PDF render → `render-pdf`, `_shared/pdf-template.ts`
- Thumbnail → `generate-store-thumbnail`, `_shared/store-thumbnail.ts`
- Final QC → `_shared/pdf-preflight.ts`, `_shared/qc/kids.ts`, `_shared/qc/kids-cover-qc.ts`, `kids-qc-run`
- Publish → `auto-list-ebook`, `list-storefront`, `ebooks.listing_status`
- Admin dashboard → `pages/admin/KidsAutopilot.tsx`, `KidsLibrary.tsx`, `KidsQcReport.tsx`, `ProductionCommandCenter.tsx`, `components/admin/OneClickAutopilotButton.tsx`

Deliver the mapping in the run report.

## 2. Cover + interior style lock (the real fix)

Root cause of the Barnaby-quality gap: cover and interior use independent prompts, no shared reference image, no locked style bible.

Changes:

- **Style Bible** — extend `kids_book_bibles` with `style_bible_json` (line quality, coloring, lighting, palette hexes, background detail, texture, framing, character proportions, title lettering direction, forbidden styles) and `cover_master_url` (the approved cover art, used as the visual anchor for every interior page).
- **Character Bible v2** — expand `character_bible_json` schema to the immutable-identifier list in the spec (face shape, proportions, palette, silhouette, signature prop, forbidden variations, reference image URLs).
- **Cover pipeline** (`generate-cover` kids branch):
  1. Pick style preset via existing `style-picker.ts`
  2. Generate a *character reference sheet* with Flux Schnell (front / 3-4 / expression) — store URL on the bible
  3. Generate cover master with Recraft V3 image-to-image using the reference sheet as `image_url`, style-bible palette baked into prompt, textless background
  4. Compose title lettering as a separate overlay (Canvas/SVG) so spelling can be verified/corrected without regen
  5. Store `cover_master_url` before any interior art runs
- **Interior pipeline** (`_shared/kids-visual-bible.ts` + `render-pdf`):
  - Every page prompt injects character bible + style bible + `cover_master_url` as i2i reference (strength 0.5–0.6)
  - Same Fal model family and palette as the cover
  - Textless — body copy stays as real PDF text layers
- **QC gate** (`_shared/qc/kids-cover-qc.ts` + new `cover-interior-match.ts`):
  - Perceptual hash + palette-distance check between cover master and each interior page
  - `cover_to_interior_match >= 90`, `character_consistency >= 90` are hard gates
  - Failures repair only the affected artifact (regenerate one page, not the whole book)

Thresholds are not lowered. Existing `kidsPublishGate` stays.

## 3. Admin control: "Build Children Picture Book"

New component `src/components/admin/BuildKidsBookButton.tsx` placed on `ProductionCommandCenter` and the main admin Dashboard. Opens a dialog with:

- Age band (All / 0-3 / 4-6 / 7-9 / 9-12 / 13+) — "All" internally picks one primary band + adjacent tags
- Themes (multi-select, chips already exist in `ThemeChips.tsx`)
- Language, target market, tone, book length, illustration intensity, price tier, autopilot mode (safe / full)

Submits to a new thin edge function `kids-book-start` that:
1. Creates the `ebooks_kids` row + `kids_production_queue` entry + `autopilot_kids_runs` row with the chosen params
2. Fires `autopilot-kids-pipeline` fire-and-forget
3. Returns `{ run_id, ebook_id }` for the UI to subscribe to live status

The existing `KidsAutopilot.tsx` status view is upgraded to show: current stage, retries, cost, cover preview, interior thumbnails grid, per-page failure reasons, before/after repair evidence, sellability verdict, publish state, and per-artifact action buttons (regen page, re-run consistency, re-render PDF, approve, reject).

## 4. Pipeline stage order (idempotent, resumable)

`autopilot-kids-pipeline` orchestrates, persisting each stage to `autopilot_kids_steps`:

market → concept → age/theme spec → story bible → character bible → style bible → page plan → manuscript → editorial QC → cover concept → cover master → interior illustrations → layout/typography → PDF render → visual+technical QC → targeted repair loop (max 3) → storefront assets → sellability gate → publish OR human_review_required.

Resume logic reads the last completed step from `autopilot_kids_steps` on re-invoke.

## 5. Commercial story standard

Concept generator scores premise / hooks / curiosity gap / protagonist / conflict / page-turn / payoff / re-read / series / positioning. Reject and regenerate if differentiation < 85 (max 3 attempts, then human review).

## 6. One live book run

After the above ships and typechecks: invoke `kids-book-start` with Age 4-6, Themes [Animals & Nature, Friendship & Family], EN/US, warm-whimsical tone, high illustration intensity, autopilot=full. Watch to completion, then report every field the spec's "Report Back" section requires.

## Technical section

**Migrations**
- `kids_book_bibles`: add `style_bible_json jsonb`, `cover_master_url text`, `character_reference_sheet_url text`
- `autopilot_kids_runs`: add `params_json jsonb` (age band, themes, language, tone, length, illustration intensity, price tier, mode)
- `qc_findings`: no schema change — already carries rule_id / severity / measured_value / threshold / evidence / repair_action
- New table `kids_cover_interior_match` (run_id, page_number, phash_distance, palette_distance, score, passed) for evidence trail

**New files**
- `supabase/functions/kids-book-start/index.ts`
- `supabase/functions/_shared/style-bible.ts`
- `supabase/functions/_shared/cover-interior-match.ts` (pHash + palette distance via existing image fetch)
- `supabase/functions/_shared/covers/kids-title-overlay.ts` (SVG title lettering composed over cover master)
- `src/components/admin/BuildKidsBookButton.tsx` + dialog form
- `src/components/admin/KidsRunDetail.tsx` (upgraded status/artifact view)

**Edited files**
- `supabase/functions/autopilot-kids-pipeline/index.ts` — insert style-bible + reference-sheet steps, chain cover master into interior generator
- `supabase/functions/_shared/kids-visual-bible.ts` — accept `cover_master_url` as i2i anchor
- `supabase/functions/_shared/covers/kids-cover-render.ts` — 2-step (ref sheet → cover master) with textless prompt + title overlay
- `supabase/functions/_shared/qc/kids.ts` — add cover_to_interior_match + character_consistency as hard gates
- `src/pages/admin/KidsAutopilot.tsx` and `ProductionCommandCenter.tsx` — mount new button + detail view
- `src/pages/admin/Dashboard.tsx` — add the button in a prominent card

**Cleanup (per prior turn's request)**
- Remove unused admin surfaces after confirming no route depends on them: audit `AutopilotControl`, `AutopilotStatusCenter`, `LiveProductionQueue` for kids vs adult overlap and delete adult-only cruft that the current two-track goal (general ebooks + kids picture books) doesn't need. Done as a separate final commit so the pipeline work is reviewable in isolation.

**Guardrails encoded in code, not prose**
- `publish_live` is gated by `sellable === true && all_hard_gates_passed === true`
- No fallback SVG cover path — remove any remaining `cover.svg` fallback in `_shared/cover.ts`
- PDF preflight already rejects non-`%PDF-` bytes and placeholder markers; keep as-is
- No review-seeding code paths anywhere

## What I need from you before running

Nothing — `FAL_API_KEY` and `LOVABLE_API_KEY` are already saved. I'll ship the code, run typecheck, deploy, and invoke one full run.
