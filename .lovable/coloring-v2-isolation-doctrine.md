# Coloring Lane V2 — Isolation Doctrine

**Flag:** `FEATURES.ENABLE_COLORING_LANE_V2` (default OFF). Mirrored in
`src/config/features.ts` and `supabase/functions/_shared/features.ts`.

## Hard isolation rules

- **Tables:** only `coloring_v2_*`. Never read/write `ebooks_kids`, `coloring_categories`, `coloring_age_bands` (v1), or any legacy table for V2 flows.
- **Storage:** only bucket `coloring-v2` (private). Never `ebook-covers` / `ebook-pdfs`.
- **Edge functions:** only `coloring-v2-*` prefix. Never invoke `coloring-book-*`, `coloring-worker-tick`, `coloring-cover-*` from V2 code (and vice versa).
- **Routes:** `/admin/coloring-lab-v2` and `/coloring-preview-v2/:bookId`, both flag-gated.
- **Cron / locks:** V2 uses its own dispatcher lock names (`coloring_v2_tick_*`). Do not reuse `production_locks` names that v1 already holds.
- **Cost cap:** V2 has its own `daily_cost_ceiling_usd` per book row; not accounted against v1's `paid-ceiling.ts`.

## Provider roles

| Provider | Role |
| --- | --- |
| Gemini (`google/gemini-2.5-pro`, `gemini-3-flash-preview`) | Concept, page plan, editorial QC, vision verification |
| OpenAI (`openai/gpt-image-2`) | Cover background, illustrated title lettering layer, premium interior, precise inpaint |
| Runware (Ideogram / SDXL) | Draft interior, fallback, upscale |

Every model call is logged in `coloring_v2_provider_calls` with model, seed, prompt version, in/out hash, cost, success.

## Status machine (independent columns)

- `generation_status`: queued → running → paused | completed | failed
- `qc_status`: pending → running → repairing → passed | failed | human_review_required
- `sellability_status`: unknown → not_sellable | sellable
- `publish_status`: draft → ready → published | unpublished (**requires human approval — never auto-publish**)

## Age bands (V2 only)

| Slug | Label | Regions | Line weight | Focal count |
| --- | --- | --- | --- | --- |
| 4-6 | Big & Easy | 15–30 | thick | 1 |
| 7-9 | Growing Detail | 30–60 | medium | 3 |
| 8-12 | Detailed Adventure | 50–100 | medium-thin | 4 |
| 13+ | Advanced Coloring | 80–160 | thin | 5 |

## Reference PDF

Store the owner's benchmark PDF at
`.lovable/coloring-v2/reference/Amazing_Earth_and_Space_PREMIUM_8.5x8.5.pdf`
(not shipped to storage; used only as a QC calibration benchmark by
rubric authors).

## Acceptance run

- 8.5×8.5, English, ages **8-12**, theme "Space and planets", 16 pages, custom illustrated title.
- Must satisfy §18 of the master prompt: spell-correct cover, no title-box font look, 16 unique interiors, no watermark/gray/text bleed, PDF opens + rasterizes, overall QC ≥90, typography ≥95, `sellability_status='sellable'`, `publish_status='draft'`.

## Build status (progress log)

- [x] Feature flag (client + server mirror)
- [x] Private storage bucket `coloring-v2` + admin-only RLS
- [x] 14-table `coloring_v2_*` schema + admin-only RLS + 4 age bands seeded
- [x] `/admin/coloring-lab-v2` UI (start form + recent-books list) — flag-gated
- [x] `/coloring-preview-v2/:bookId` — flag-gated
- [x] `coloring-v2-start` edge function
- [ ] `coloring-v2-concept` (Gemini uniqueness-gated titles)
- [ ] `coloring-v2-style-bible`
- [ ] `coloring-v2-page-plan` (exact 16/32 unique scenes)
- [ ] `coloring-v2-interior-render`
- [ ] `coloring-v2-cover-compose` (layered art + illustrated lettering + OCR spell verify)
- [ ] `coloring-v2-qc` (measured rule engine)
- [ ] `coloring-v2-repair` (inpaint-first, ≤5/page)
- [ ] `coloring-v2-pdf-assemble`
- [ ] `coloring-v2-pdf-verify`
- [ ] `coloring-v2-storefront-package`
- [ ] `coloring-v2-tick` (own dispatcher + own lock names)
- [ ] Automated tests (flag isolation, table isolation, age-band matrix, gates, resume idempotency)
- [ ] Acceptance run (Space and planets · 8-12 · 16p) + evidence report
