
# Premium Coloring Book Lane V2 — Isolated Build Plan

Goal: build a **parallel** coloring pipeline (`coloring_v2_*`, `/admin/coloring-lab-v2`) that never mutates the existing lane's routes, tables, storage, functions, or status machine. Gated by `ENABLE_COLORING_LANE_V2` (default OFF).

## 0. Isolation contract (hard rules)
- No edits to existing `coloring-*` edge functions, `ebooks_kids`, `coloring_*` tables (non-v2), `ebook-pdfs` / `ebook-covers` buckets, or existing routes.
- New code is additive only. Old migrations untouched.
- Namespaces:
  - Routes: `/admin/coloring-lab-v2`, `/coloring-preview-v2/:bookId`
  - DB prefix: `coloring_v2_`
  - Storage bucket: `coloring-v2` (private)
  - Edge functions prefix: `coloring-v2-`
  - Log prefix: `[COLORING_V2]`
  - Flag: `ENABLE_COLORING_LANE_V2` (client + server mirror in `src/config/features.ts` and `supabase/functions/_shared/features.ts`)
- Regression guard: existing test suite must remain green; add explicit tests that old routes/functions are untouched.

## 1. Age bands (per user answer — expand site)
Add new slugs used **only inside V2** (existing SEO/taxonomy unchanged):
- `4-6` Big & Easy — 15–30 regions, thick lines, 1 focal subject
- `7-9` Growing Detail — 30–60 regions
- `8-12` Detailed Adventure — 50–100 regions
- `13+` Advanced Coloring — 80–160 regions

Stored in new `coloring_v2_age_bands` seed table with density/line-weight/region targets driving prompt + QC thresholds. Existing `coloring_age_bands` untouched.

## 2. Data model (new migrations, additive)
Tables (all with `GRANT` + RLS + `service_role`):
`coloring_v2_books`, `coloring_v2_runs`, `coloring_v2_steps`, `coloring_v2_style_bibles`, `coloring_v2_character_bibles`, `coloring_v2_page_plans`, `coloring_v2_assets`, `coloring_v2_provider_calls`, `coloring_v2_qc_runs`, `coloring_v2_qc_findings`, `coloring_v2_repairs`, `coloring_v2_pdf_artifacts`, `coloring_v2_storefront_packages`, `coloring_v2_age_bands`.

Independent status columns: `generation_status`, `qc_status`, `sellability_status`, `publish_status` (publish default `draft`; requires human approval).

New private storage bucket `coloring-v2`, path `{book_id}/{run_id}/...`.

## 3. Provider router (V2-only adapter)
New `supabase/functions/_shared/coloring-v2/providers/` reusing existing secrets (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `RUNWARE_API_KEY`) via new adapters — does NOT touch `_shared/image-providers.ts` or `_shared/runware.ts` behavior.

Roles:
- **Gemini** — concept/plan/QC-editorial/vision
- **OpenAI (gpt-image-2)** — primary cover, illustrated lettering layer, premium interior, precise inpaint repair
- **Runware** — draft/fallback/upscale

Every call records model, prompt version, seed, in/out hash, cost. No silent downgrade.

## 4. Pipeline stages (edge functions)
1. `coloring-v2-start` — accept controls, create book row
2. `coloring-v2-concept` — Gemini: 5 titles, subtitles, hook, uniqueness check vs v2 corpus, score ≥85 or regenerate
3. `coloring-v2-style-bible` — style + character bible persisted
4. `coloring-v2-page-plan` — exactly 16 or 32 unique scenes with fingerprints
5. `coloring-v2-interior-render` — per-page generation w/ style bible + prior refs
6. `coloring-v2-cover-compose` — layered: background art → illustrated title lettering (separate layer) → OCR spell verify → composite → badge → thumbnail readability at 160/320px
7. `coloring-v2-qc` — measured rules (see §5)
8. `coloring-v2-repair` — targeted per-artifact/region repair (inpaint first, full regen last), max 5/page, then `human_review_required`
9. `coloring-v2-pdf-assemble` — real PDF 8.5×8.5, embedded fonts, real text layers for facts
10. `coloring-v2-pdf-verify` — rasterize each page back to PNG, re-run QC
11. `coloring-v2-storefront-package` — copy + previews (publish stays `draft` until human approval)
12. `coloring-v2-tick` — isolated dispatcher (own cron, own lock names)

## 5. Automated QC rules (measured, no hardcoded pass)
IMAGE_EXISTS, IMAGE_DIMENSIONS, SQUARE_ASPECT, SAFE_MARGIN (≥7%), PURE_WHITE_BACKGROUND, GRAYSCALE_PIXEL_RATIO, SOLID_BLACK_AREA_RATIO, LINE_DENSITY_BY_AGE, CLOSED_REGION_DISTRIBUTION, WATERMARK_DETECTION, OCR_UNEXPECTED_TEXT, DUPLICATE_SIMILARITY (pHash), PAGE_COMPOSITION_SIMILARITY, CHARACTER_CONSISTENCY, STYLE_CONSISTENCY, ANATOMY_ANOMALY, HAND_FINGER_ANOMALY, MECHANICAL_COHERENCE, CROPPED_SUBJECT, PRINT_LEGIBILITY, COVER_TITLE_SPELLING (non-waivable), COVER_THUMBNAIL_READABILITY.

Each finding: rule_id, severity, page, measured_value, threshold, evidence crop, repair action, retry count, verification.

## 6. Admin UI (`/admin/coloring-lab-v2`)
Start form (age mode select/random from 4 V2 bands, theme select/custom/random/surprise, language, page count 16/32, complexity, facts on/off, cover mood, character auto/custom, provider mode, autopilot mode, seed lock, retry budget), progress timeline, per-step provider/model/cost, cover preview at full/320/160, page thumbnail grid with failure badges, finding drawer w/ evidence + before/after, actions: approve cover, regenerate/repair page, Auto Repair All, pause/resume, re-run QC, re-render PDF, download PDF + QC report, duplicate settings w/ new random theme. Experimental banner.

Nav link appears only when flag ON.

## 7. Customer preview (`/coloring-preview-v2/:bookId`)
Read-only preview of approved cover + sample pages. Not linked in public nav. No purchase path.

## 8. Tests (additive)
- Flag isolation (routes/functions gated)
- Existing routes/functions unchanged (snapshot)
- V2 table + storage isolation
- Age-band prompt rule matrix
- Exact page count 16 / 32
- Gates: gray, watermark, unexpected OCR text, duplicate, cover spelling, safe margin, invalid PDF, missing page, publish gate, retry-exhaustion → `human_review_required`, idempotent resume
- Regression run of existing coloring test files must remain green

## 9. Acceptance run (mandatory)
Execute one real book after implementation:
- 8.5×8.5, English, ages **8-12**, theme "Space and planets", 16 coloring pages, custom illustrated title lettering.
- Must satisfy every criterion in §18 of master prompt (spell-correct cover, no title-box font look, 16 unique interiors, no watermark/gray/text, PDF opens and rasterizes, overall QC ≥90, typography ≥95, sellability = sellable, publish stays `draft`).
- Report: files added, migrations, routes, functions, provider mapping, e2e result, QC scores, failed/repaired pages, PDF path, time, cost, unresolved findings.

## 10. Reference PDF
The uploaded `Amazing_Earth_and_Space_PREMIUM_8.5x8.5.pdf` will be stored under `.lovable/coloring-v2/reference/` as a **quality benchmark only** (not copied into outputs) and used by QC rubric authors to calibrate density/line-weight thresholds.

## Technical notes
- Flag lives in `src/config/features.ts` + `supabase/functions/_shared/features.ts` (mirror).
- Cost-cap safety: V2 has its own daily USD ceiling separate from existing `paid-ceiling.ts`.
- All V2 functions declare their own cron/lock names — no shared locks with v1.
- Publish switch requires explicit UI click + admin role check via `has_role`.
- Bucket `coloring-v2` created via `supabase--storage_create_bucket` (private), not SQL.

## Explicitly out of scope
- Auto-publish, Shopify, royalty/exchange integration, SEO landing generation for V2 books, migrating any v1 book into V2.

Awaiting approval to switch to build mode and implement in this order: migrations → adapters → edge functions → admin UI → tests → acceptance run.
