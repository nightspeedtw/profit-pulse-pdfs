## Why the kids cover/thumbnail comes out wrong

I traced the pipeline. The kids track was **half-decoupled** — the character/illustration is bible-locked, but the cover then gets composited through the adult template and QC'd with the adult rubric. Result: the AI paints a beautiful hero illustration, then the app wraps it in a near-black finance-book chrome (EBOOK chip, condensed uppercase sans title, hairline rules, 4 feature chips) and passes that same file through as the storefront thumbnail. It doesn't look like a picture book at all — and when QC judges it against the adult rubric, it either fails ("no hierarchy", "no accent chips") or passes but ships something off-brand.

Concretely, in `supabase/functions/generate-cover/index.ts`:

- Lines ~640–652: kids branch swaps only the **background prompt** to the visual-bible-locked illustration.
- Line 685: `buildCoverSVG(spec, bgBytes)` — always the adult template. There is no kids equivalent.
- Line 690: `renderThumbnail(spec, bgBytes, coverPng, styleRef)` — always the adult book-mockup renderer.
- Line 697+: `COVER_QC_SYSTEM` — adult rubric.

And `generate-store-thumbnail/index.ts` (line ~96): the kids passthrough reads `cover_url`, which is the adult-styled composite — so the storefront thumbnail inherits the same problem. `_shared/covers/kids-cover.ts` and `_shared/thumbnails/kids-thumbnail.ts` are style-hint constants that nothing actually consumes.

Nimble's book is stuck at `listing_status=draft` for the same reason: cover step produces something that fails the QC gate under mismatched rules and the run halts.

## The fix — finish the kids-track separation for the visual layer

### 1. Dedicated kids cover renderer

Add `supabase/functions/_shared/covers/kids-cover-render.ts` that builds a real picture-book cover:

- 1600×1600 square (industry standard for children's ebooks), NOT 2:3 hardcover.
- Full-bleed hero illustration from the visual bible — no black field, no chips, no hairline rules, no "EBOOK" tag.
- Title overlay: hand-lettered rounded storybook display face, warm cream fill with soft drop shadow, positioned in the reserved zone the illustration prompt already leaves (top third).
- Optional small subtitle (age range) in the bottom-right in the same family, muted.
- Palette pulled from `kids_visual_bible.color_palette` — never the finance gold/cyan accents.
- Same `buildCoverSVG` → `rasterizeSVG` shape so nothing downstream changes API-wise, but the SVG structure is completely different.

### 2. Kids compose branch in `generate-cover`

In `index.ts` around lines 619–695:

- After `spec` is built, when `isKidsCover === true`, skip the adult spec normalization (feature chips, accent_key, EBOOK chip, black palette) and load the visual bible.
- Call the new `buildKidsCoverSVG(bible, ebook.title, ebook.subtitle)` instead of `buildCoverSVG(spec, bgBytes)`.
- Rasterize as usual and upload to `cover.png`.
- Store a simplified `cover_spec` that reflects what was rendered (title, palette, style_id, bible_id) so the admin UI shows something meaningful.

### 3. Kids thumbnail — render a real cover file, don't reuse the raw background

Two changes:

- In `generate-cover`, when kids, also write the same square composited cover to `thumbnail.png` (skip `renderThumbnail`'s adult book-mockup entirely — it would break the storybook feel).
- In `generate-store-thumbnail`, the passthrough already picks up `cover_url`; that now points at the properly composed kids cover, so `store_thumbnail_url` finally matches. No logic change needed beyond confirming the branch is hit (the current regex `kid|children|picture book|storybook…` already matches "Digital Picture Book (PDF)").

### 4. Kids QC gate at composition time

Replace the adult `COVER_QC_SYSTEM` call for kids with a small kids rubric (already scaffolded in `_shared/qc/kids.ts`) scoring:

- character_consistency_with_bible ≥ 95
- illustration_style_match ≥ 95
- title_readable_on_illustration ≥ 90
- palette_matches_bible ≥ 95
- no_adult_chrome (no chips, no black field, no hairlines) = 100 (hard gate)
- thumbnail_appeal_at_160px ≥ 90

Auto-fix loop stays at max 3 attempts. Failure reasons feed back into either the illustration prompt (character/style drift → regenerate bg only) or the SVG overlay (title unreadable → shift zone/increase size).

### 5. Recover the Nimble book

Once the code is in, re-run `autopilot-kids` on `a0b0b35a-c06f-4e1c-ad0b-b98d4723697f` with `mode: "full"`. It's idempotent — manuscript stays, only cover + thumbnail regenerate and it advances to Shopify draft → publish live.

### Files changed

```text
supabase/functions/_shared/covers/kids-cover-render.ts   (new — SVG builder)
supabase/functions/_shared/qc/kids-cover-qc.ts           (new — 6-dim rubric + gate)
supabase/functions/generate-cover/index.ts               (kids branch: skip adult template + QC)
supabase/functions/generate-store-thumbnail/index.ts     (confirm passthrough picks up new cover)
supabase/functions/_shared/covers/kids-cover.ts          (delete — replaced by renderer above)
supabase/functions/_shared/thumbnails/kids-thumbnail.ts  (delete — passthrough is enough)
```

### Non-goals for this pass

- Not touching the adult cover/thumbnail path.
- Not changing the visual bible or manuscript logic — the illustration itself is already good; only the compositing was wrong.
- No DB migration.

Want me to build it?