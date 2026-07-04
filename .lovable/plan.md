## Goal

Match the reference examples (photo-real black hardcover, huge title, feature-icon strip, real page edges, studio lighting) — not the current flat SVG.

## Diagnosis

Current pipeline is 100% deterministic SVG. That guarantees correct text but caps realism at "vector book icon" level. Reference images are photographic: real cover texture, real page block, real studio lighting, real illustration composited on cover. No amount of SVG polish reaches that.

## Solution: Hybrid pipeline

Two stages, both automatic, both deterministic in text:

**Stage 1 — Deterministic cover face (SVG → PNG, 1600×2400)**
Redesign to match reference layout:
- Bebas-Neue title at 180-220pt, fills 55-70% of cover height, max 3 lines
- Full subtitle with divider lines above/below (no truncation — wrap to 3 lines if needed)
- Category badge top-left (yellow pill: EBOOK / DIGITAL PLANNER / WORKBOOK)
- 4 feature icons + labels along the bottom (from ebook `key_benefits` / `benefit_bullets` / auto-derived from category)
- Category-specific hero illustration zone in the middle-bottom (photo asset from a small curated library per category, or a stronger SVG composition — staircase, shield, ladder, waveform, circuit, leaf)
- Subtle paper-grain texture overlay

**Stage 2 — Photoreal 3D book mockup (AI Gateway)**
Call `google/gemini-3.1-flash-image` (via Lovable AI Gateway, existing `LOVABLE_API_KEY`) with:
- Reference image = Stage 1 PNG
- Prompt: "Photorealistic hardcover book product photograph on white studio background, 3/4 angle, using this exact cover art as the front cover with no changes to text or layout, visible spine and page edges, soft studio lighting, subtle contact shadow, magazine-quality product shot. Do not add or change any text."
- 2 attempts. If AI drift changes text → fallback to compositing Stage 1 onto a pre-rendered photoreal blank-book template via SVG perspective transform.

**QC gate**
- OCR the AI output, compare title against DB title with fuzzy match — if edit distance > 3 chars, reject that attempt.
- Bytes > 200KB (photo output).
- Sample 6 white-background pixels — mean brightness > 240.
- Retry up to 2×; if all fail → keep Stage 1 result and mark `thumbnail_needs_review`.

## Files to change

- `supabase/functions/_shared/book-mockup.ts` — split into `buildCoverFaceSvg()` (redesign) + `generatePhotorealMockup()` (new AI call) + `compositePhotorealFallback()` (SVG perspective onto pre-rendered blank-book PNG asset).
- `supabase/functions/_shared/blank-book-templates/` (new) — 3 pre-generated photoreal blank-book PNG assets (hardcover, workbook, softcover) with mapped perspective corners in a sidecar JSON. Generated once via `imagegen`, then reused.
- `supabase/functions/generate-store-thumbnail/index.ts` — orchestrate new stages, OCR/QC checks.
- `supabase/functions/_shared/store-thumbnail.ts` — retire the older deterministic mockup path (keep only as emergency fallback).

No migrations. No PDF / manuscript / price / copy / Shopify changes.

## Backfill

Regenerate the 8 listed products after deploy. Report before/after screenshots and per-product QC.

## Risk / trade-off

- AI cost per thumbnail: 1 image gen (~$0.01-0.03). Only runs on cover approval or manual "Regenerate Store Thumbnail".
- AI may still occasionally drift text → OCR gate + Stage-1 fallback protects against shipping wrong text.
- Blank-book template fallback keeps output photoreal even when AI Gateway is down.

## Out of scope

Not touching: cover_url, PDF, prices, product copy, listing status, Shopify, storefront card layout (already fixed to white BG + object-contain last turn).
