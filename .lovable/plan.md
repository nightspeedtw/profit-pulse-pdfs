# Reference-Grade Photoreal Thumbnails — 2 Samples Only

## Scope (strict)
Rebuild the thumbnail renderer for 2 books ONLY. No backfill until the 2 samples pass.

- `cfc0ab97-ec48-447a-a0ca-73513e36941f` — **The Six-Month Debt Exit Strategy**
- `160f23dd-2c74-4bd0-910d-2fb3d1a5b00e` — **The Deep Energy Protocol**

No PDF / manuscript / price / copy changes. No Shopify calls. No pipeline changes.

## Why current output fails
Existing renderer (`_shared/book-mockup.ts` + `generate-store-thumbnail`) composes an SVG "3D-ish" book — perspective is faked in vector, so it always reads as a template. Self-reported QC scores are inflated (96/100) because the QC critic sees SVG, not photorealism.

## New two-stage approach

### Stage 1 — Deterministic cover face (HTML → PNG via Browserless)
`_shared/cover-face.ts` (new) — renders a 1600×2400 HTML cover with:
- Exact title/subtitle/badge in Bebas Neue / Anton / Playfair (baked into image, never AI text)
- Topic illustration composed from Lucide SVGs + gradients + halftone textures
- Palette per book (Debt Exit = matte black + white/gold; Deep Energy = deep forest green + cream)
- Poster-style typography hierarchy matching the uploaded references
- Rendered via existing Browserless (`BROWSERLESS_TOKEN` already set) → PNG buffer

### Stage 2 — Photoreal book mockup composite (Gemini 3 Pro Image edit)
`_shared/photoreal-mockup.ts` (new) — takes the Stage 1 cover face as `image_paths[0]` and calls Lovable AI Gateway `google/gemini-3-pro-image` (image edit) with the prompt:

> "Take the provided flat book cover artwork and place it EXACTLY as-is onto the front cover of a premium hardcover book, photographed as a realistic product photo on a clean off-white studio background, slight three-quarter angle, visible spine and page edge with realistic paper thickness, matte cover texture, subtle soft shadow beneath the book, book fills 78–90% of frame height, professional ecommerce photography, crisp studio lighting. Do NOT alter, redraw, or add text to the cover — preserve every letter of the provided artwork pixel-for-pixel on the front face."

Gemini 3 Pro Image is the only model on the gateway that reliably preserves reference typography under geometric transforms.

Output: 1600×1600 PNG on white → upload to `ebook-covers` bucket → signed URL → `ebooks.store_thumbnail_url`.

### QC gate (new)
`_shared/thumbnail-qc-photoreal.ts` — AI critic scores 10 axes on 0–100:
- `reference_grade_realism_score` ≥ 92
- `book_size_score` ≥ 90 (book height ≥ 78% of frame)
- `white_bg_product_photo_score` ≥ 95
- `cover_typography_score` ≥ 90
- `title_baked_in_score` ≥ 95 (title matches exact expected string, no AI-drift)
- `topic_illustration_score` ≥ 85
- `spine_page_depth_score` ≥ 90
- `shadow_lighting_score` ≥ 90
- `store_click_appeal_score` ≥ 90
- `final_store_thumbnail_score` ≥ 92

Hard fail = template look, dark bg, small book, distorted/missing title, no spine/depth, no shadow.

Retry up to 2 times per sample with sharpened prompts. If still failing → **STOP**, do not overwrite `store_thumbnail_url`, report the exact blocker.

## New endpoint
`supabase/functions/generate-photoreal-thumbnail/index.ts` — POST `{ ebook_id }` → runs Stage 1 → Stage 2 → QC → conditional save. Manual call only, not wired into orchestrator yet.

## Verification loop
1. Call the new function for both ebook IDs.
2. Fetch the generated PNGs, open `/library` in Playwright, screenshot both cards.
3. Report URLs, per-axis QC scores, screenshot, pass/fail verdict.

## What I will NOT do
- Not touch pdf-template, render-pdf, chapters, prices, product copy.
- Not call Shopify.
- Not backfill the remaining 30+ products.
- Not overwrite the current `store_thumbnail_url` unless the new sample passes every hard gate.

## What I need from you
1. **OK to spend Gemini 3 Pro Image credits** on ~3–6 total image generations (2 samples × up to 3 retries)?
2. **OK with the 2-stage architecture** above (HTML cover face + Gemini 3 Pro Image composite), rather than a fixed mockup template library?
3. If Gemini 3 Pro Image still distorts the reference typography under the transform (known model limitation on aggressive perspective), the fallback is a **fixed PNG mockup template library** with a Skia/Canvas perspective composite of the cover face — OK to fall back to that automatically, or stop and report?
