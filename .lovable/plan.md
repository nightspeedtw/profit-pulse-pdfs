## Goal

Make every ebook thumbnail look like the reference you uploaded (dark hardcover, dramatic side light, polished black marble surface, visible spine, premium bookstore hero shot) — but with the **cover artwork itself themed to each book's topic** (not a one-size-fits-all black cover).

## What's wrong today

- The current mockup prompt only tweaks the *environment* (marble, moody light). It still just wraps whatever flat cover the pipeline produced onto a book — so the result doesn't match your reference.
- The reference has a very specific *cover design language* too: solid black field, huge condensed sans title in white with **one word highlighted in yellow**, thin hairline rules around a short subtitle, small "EBOOK" chip top-left, and 4 icon+label feature chips along the bottom. That whole language is missing from our flat-cover generator.

## Plan

### 1. Lock a "Reference Hardcover" cover template
Add a new deterministic template in `supabase/functions/_shared/cover.ts` that produces the flat 2:3 cover in the reference style:

- Solid dark field (default `#0b0b0b`), subtle noise/paper texture.
- Top-left `EBOOK` chip in the book's accent color.
- Huge condensed sans title (Anton / Bebas-family), 2–4 lines, one keyword auto-highlighted in the accent color.
- Two thin hairline rules bracketing a 2-line subtitle.
- Central hero illustration zone (per-book, see step 2).
- Bottom row: 4 auto-generated icon+label chips derived from the book's benefits/framework.
- Spine + back-cover art matched to the same palette.

### 2. Per-book theming (content-aware)
Each book gets its own palette, hero metaphor, and 4 feature chips derived from its `CoverSpec`:

- **Accent color** — chosen from the psychological lever (finance/debt → gold, productivity → electric blue, health → emerald, identity → magenta, etc.).
- **Hero illustration** — textless AI image sized to the reserved zone, prompted from the book's core metaphor (e.g. "staircase to a lit doorway" for debt exit, "clean desk at dawn" for focus, "mountain summit" for identity, etc.). Still governed by the `world-class-cover-designer` skill's textless + anti-AI rules.
- **Feature chips** — 4 short 1–2 word labels + Lucide-style icons, auto-derived from the book's promise (e.g. Clear Plan · 6-Month Framework · Build Momentum · Financial Freedom).

### 3. Cinematic mockup (already partially done — tightened)
Keep the moody marble/side-light mockup in `renderPhotorealThumbnail`, but tighten it:

- Wider frame so the whole book + spine + marble reflection is visible.
- Force the specific rim-light direction, spine color match, and long soft reflection from the reference.
- Fail QC if the mockup returns a light/white studio background.

### 4. QC gates raised to enforce this style
In `_shared/cover.ts` add two hard gates the mockup must pass, else regenerate (max 3):

- `reference_style_match_score` ≥ 90 — dark cinematic marble, hardcover, spine visible, rim light.
- `content_theming_score` ≥ 90 — accent color + hero metaphor + chips match the book's topic (not generic).

### 5. Apply retroactively to existing 7 listed books
Add an admin action "Regenerate all thumbnails" on the Live Production Queue that re-runs `generate-cover` for every listed ebook using the new template, then re-uploads the resulting `cover_url`.

### Files touched

- `supabase/functions/_shared/cover.ts` — new `renderReferenceStyleCover()` template + updated QC schema.
- `supabase/functions/generate-cover/index.ts` — call the new template, tightened mockup prompt, new gates, retry loop.
- `src/components/admin/LiveProductionQueue.tsx` — "Regenerate all thumbnails" bulk button.

### Out of scope

- Redesigning the PDF interior.
- Changing pricing / checkout / download flow.
- Non-ebook product types.

## Questions before I build

1. **Accent color per category** — OK if I auto-pick (finance = gold, productivity = electric blue, health = emerald, mindset = magenta, business = white-on-black only), or do you want to lock **every** book to the black + yellow reference palette?
2. **Bottom feature chips** — auto-generate 4 chips from each book's content (varied per book), or keep a fixed set like the reference (Clear Plan · Framework · Momentum · Freedom)?
3. **Retro-apply** — regenerate thumbnails for the 7 already-listed books now, or only apply to new books going forward?
