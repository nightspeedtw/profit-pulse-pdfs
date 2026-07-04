
# Fix distorted book mockups and clipped cover text

From your screenshots, two real problems are visible on the storefront thumbnails:

1. **Text clipping on the front face.** "The Feast-or-Famine Escape Plan" renders as "…EAST-OR-FAMINE …SCAPE PLAN" — the first letter of each line is cut off. "6-Month Framework" badge is also cropped to "-MONTH FRAMEWOR". This is happening on the deterministic Stage‑1 cover face (HTML → PNG), before Gemini ever sees it. The title layout uses a fixed 120px inset with a 230px display font and lines that can exceed the safe width, so long words overflow the left/right edges.
2. **Book geometry looks wrong.** The Gemini composite is producing an over‑tall / narrow book with an exaggerated spine perspective and inconsistent page-edge thickness. It reads as a stretched 3D render, not a real hardcover. The current prompt doesn't lock aspect ratio, camera angle, or physical proportions, so each attempt drifts.

## What I'll change (thumbnail pipeline only — no PDF, manuscript, price, copy, or Shopify)

### A. Stage 1 — deterministic cover face (`supabase/functions/_shared/cover-face.ts`)
- Add a real safe‑area: increase `.content` inset to 160px and cap title block width at 1280px.
- Auto‑fit the title: measure the longest line and scale font-size down from 230px in steps (210 / 190 / 170 / 150) until every line fits within the safe width. Never let a line overflow.
- Improve line breaking: never break so a single-word line is longer than the safe width; when a word alone exceeds width, shrink font, don't clip.
- Badge: allow it to wrap to two lines and cap at `max-width: 900px` so "6‑MONTH FRAMEWORK" is never cropped.
- Same guardrails applied to subtitle and footer chips.

### B. Stage 2 — photoreal mockup prompt (`supabase/functions/_shared/photoreal-mockup.ts`)
Rewrite the geometry constraints so Gemini stops distorting the book:
- Lock **cover aspect ratio to 1:1.5** (standard trade hardcover) and state it explicitly.
- Lock **camera**: "straight-on front view rotated ~12° to the right around vertical axis, camera at cover center height, no tilt, no perspective foreshortening beyond that angle."
- Lock **physical proportions**: "spine thickness 6–8% of cover width, visible page block on the right with realistic uniform paper layers, cover corners square and equal, no barrel/pincushion distortion."
- Explicit negatives: "no stretched or elongated book, no tall narrow proportions, no warped cover, no fisheye, no exaggerated perspective, no floating book."
- Reinforce: "reproduce the provided front‑cover artwork pixel‑for‑pixel — no cropping, no re‑layout, no added or removed text."
- Keep the bright cool off-white background (#f6f4ef) and the soft contact shadow rules already in place.

### C. QC gates (`supabase/functions/_shared/thumbnail-qc-photoreal.ts`)
Add two hard gates so a distorted or clipped result cannot be promoted:
- `text_integrity_score` ≥ 92 — critic checks that every word from `title`, `subtitle`, and `badge` is fully visible and uncut on the rendered cover. Any clipped letter fails.
- `book_geometry_score` ≥ 88 — critic checks aspect ratio, spine width %, corner squareness, and absence of warping.
Repair hints for these feed back into the Stage‑2 retry loop.

### D. Regenerate the two sample books
After the code changes, re-run `generate-photoreal-thumbnail` (max_attempts=3) for:
- Deep Energy Protocol (`160f23dd-…`)
- Six-Month Debt Exit Strategy (`cfc0ab97-…`)
Only promote (`store_thumbnail_url` update) if the new `text_integrity` and `book_geometry` gates both pass. If Gemini 403‑throttles, wait and retry — no manual override this round, because the whole point is passing the new gates.

## What I will NOT touch
- PDF, manuscript, pricing, selling copy, listing metadata
- Shopify (no push, no publish)
- Any file outside the thumbnail pipeline

## Deliverable
Two new thumbnails that (a) show every letter of the title/subtitle/badge with no clipping and (b) look like a realistic hardcover with correct 1:1.5 proportions and a natural spine — or a clear report of exactly which gate blocked promotion and the inspection URL to review.

Approve and I'll implement.
