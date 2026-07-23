Three coordinated upgrades: (A) upgrade the sales page with a real full-book Look Inside flipbook, (B) refresh the cover art direction to look bright, vivid, modern-2026, and (C) diversify title/theme rotation so new books stop clustering on unicorns/dragons.

## A. Look Inside flipbook on the sales page

**Where:** `src/pages/ColoringProduct.tsx` + a new `src/components/product/LookInsideFlipbook.tsx`.

**What the reader gets:**
- A prominent "Look Inside — flip every page" CTA button under the gallery (above the buy box on desktop, sticky on mobile).
- A full-screen lightbox that shows ALL interior preview pages available for the book (not just 6). Pages advance with:
  - Click / arrow keys / swipe on mobile
  - A "Play flipbook" mode that auto-turns at 1.2s per page (existing `FlipbookPreview` behavior, extended)
  - A page-turn CSS animation (`transform: rotateY` on a 3D card) so it feels like a real book, not a slideshow
- Page counter (`3 / 32`), thumbnail strip along the bottom, and "Buy now — $X.XX" CTA pinned to the lightbox footer so the flow stays commercial.
- If the book has fewer than 4 preview pages we show a friendly "sample coming soon — the full 32-page PDF unlocks after purchase" state instead of a broken preview.

**Data:** we already store previews in `ebooks_kids.metadata.preview_page_urls`. This turn we also read `metadata.gallery_urls` (interior renders) and fall back to `coloring_v2_assets` (kind='interior', signed 10y URL) so the flipbook can show every rendered page, not just the 6-page preview slice.

**Selling points added around the flipbook:**
- Row of trust chips: "Instant PDF download", "Print at home or send to print shop", "Personal + classroom use", "32 unique pages", "8.5×8.5 in".
- One-line "Powered by Runware AI illustration" credit chip next to the trust chips, so the AI provenance is visible without dominating the page.
- A small "What you'll be able to do" card list under the flipbook: color digitally on iPad, print unlimited copies for one household, gift to friends, etc.

**No backend changes required** — the flipbook reads existing published data.

## B. Brighter, more modern 2026 cover art direction

**Where:** `supabase/functions/coloring-v2-illustrated-cover-once/index.ts` (prompt) and, for future books, `supabase/functions/coloring-v2-cover/index.ts`.

**Prompt changes (a rotating art-direction pool, not one fixed style):**
- Introduce a `COVER_ART_MOODS` array with 6 distinct 2026 moods, e.g.
  - `neon-pop` — hot pink / electric yellow / cyan / violet, glossy risograph
  - `sunset-blaze` — coral / marigold / magenta / violet, sunset gradient sky
  - `candy-bright` — pastel highlighter (blush / mint / lemon / sky), stickery
  - `vapor-chrome` — iridescent pastels + chrome accents, Y2K/2026 futurism
  - `tropical-hi-fi` — turquoise / lime / hibiscus, saturated jungle-print energy
  - `dreamy-holo` — soft holographic pastels with sparkle highlights
- Each cover deterministically picks a mood from the book id hash so covers spread visually across the shelf instead of all looking alike.
- The prompt is rewritten to explicitly demand: "bright saturated 2026 picture-book aesthetic, high-chroma palette, joyful energy, glossy playful mark-making — do NOT look muted, retro, vintage, sepia, dusty, or watercolor-washed. Reject any 'faded old storybook' feeling. Cover should read as a fresh 2026 shelf release."
- Kept: FULL-BLEED, hand-lettered title inside the art, anatomically complete characters, no font overlays, no borders/frames.
- Also add a subtle "poster energy" clause — bold shape language, clear focal hero, thumbnail-punchy at 160px — so the covers pop in the catalog grid.

**No retroactive regeneration** — existing live covers stay. The new prompt applies to any cover regenerated from now on, matching the "One-Book-At-A-Time" law.

## C. Diversified theme rotation

**Where:** `supabase/functions/coloring-v2-autopilot/index.ts` — `THEME_POOL` + `pickTheme`.

**New pool structure per age band** — themes are grouped into 5 buckets so the rotator forces variety instead of hammering the same bucket:

1. `real_animals_nature` — Jungle Safari Friends, Coral Reef Explorers, Arctic Adventures, Backyard Bugs, Rainforest Canopy, Prairie Wildlife…
2. `vehicles_city_jobs` — Fire Station Heroes, Space Mission Control, Robot Workshop, Chef's Kitchen, Construction Zone, Pilot's Sky Tour…
3. `food_shops_daily_life` — Bakery Morning, Ice Cream Truck, Farmer's Market, Backyard Garden, Toy Store Wonders, Pajama Party…
4. `world_culture_travel` — Tokyo Neon Streets, Marrakech Market, Nordic Aurora, Kyoto Cherry Blossom, Rio Carnival, Reykjavik Puffins…
5. `imagination_fantasy_space` — Neon Rebellion, Cosmic Whales, Cloud Kingdom, Time-Machine Tea Party, Dream Balloons, Moon Colony Kids… (kept from today's pool but capped)

**Rotation rule (`pickTheme`):**
- Read the last N=10 books created for this age band, extract each book's `bucket` (stored in `metadata.theme_bucket`).
- Choose the bucket with the fewest hits in that window (ties broken randomly) to guarantee spread.
- Inside the chosen bucket, pick an unused title first; if all are used, generate a fresh compound title from a small adjective + noun list ("Sparkling Bakery Morning", "Mighty Coral Reef Explorers") so we don't fall back to "Volume 274" numeric suffixes.
- Save `metadata.theme_bucket` on the created book so the next tick can see the distribution.

**Result:** across every 5 books the autopilot creates, all 5 buckets get hit at least once. No more "unicorns / dragons / mermaids" back-to-back.

## Technical details

- **New file:** `src/components/product/LookInsideFlipbook.tsx` — full-screen modal, keyboard + swipe nav, page-turn CSS, thumbnail strip, buy CTA. Reuses existing `PreviewLightbox` styling tokens (no new colors).
- **Edited files (frontend only for A):** `src/pages/ColoringProduct.tsx` (mount button + modal, wire preview URLs), `src/components/product/ColoringPreviewModule.tsx` (add Runware credit chip + expanded trust chips).
- **Edited files (backend for B):** `supabase/functions/coloring-v2-illustrated-cover-once/index.ts` — add `COVER_ART_MOODS`, pick mood by hash of book id, inject mood clause into prompt, add "bright modern 2026" positive/negative clauses.
- **Edited files (backend for C):** `supabase/functions/coloring-v2-autopilot/index.ts` — replace `THEME_POOL` and `pickTheme` with the bucketed rotator; write `metadata.theme_bucket` on insert.
- **Tests:**
  - `src/__tests__/coloring-theme-bucket-rotation.test.ts` — pickTheme visits all 5 buckets across 10 sequential picks.
  - `src/__tests__/coloring-cover-bright-2026-prompt.test.ts` — cover prompt contains the "bright, saturated 2026" positive clause and forbids "muted/vintage/sepia".
  - `src/__tests__/coloring-look-inside-flipbook.test.tsx` — modal opens, cycles pages, closes on Escape, shows page counter.

## Out of scope for this turn

- No regeneration of existing live covers.
- No new payment/checkout flow — the Buy CTA inside the flipbook reuses the existing `onBuy` handler.
- No changes to interior page rendering, PDF layout, or QC gates.
