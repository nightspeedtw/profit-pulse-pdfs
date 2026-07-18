# Coloring Display Surfaces — SQUARE-FIRST Law (v1, 2026-07-18)

**Rule.** Every UI surface that renders a coloring-book thumbnail or cover
uses a **square** aspect-ratio container with **exact-fit** rendering
(`object-contain` on a **white** background). The marketing thumbnail
produced by `coloring-marketing-thumbnail` v4+ is native 1:1; legacy
rectangular covers must also display **complete** (never cropped).

Applies to:

- Sale page hero (`ColoringProduct.tsx`) — hero button + thumbnail rail.
- Sale page cross-sell rail (`ColoringProduct.tsx`) — sibling tiles.
- Kids grid cards (`components/kids/KidsBookCard.tsx`).
- Category pages (via `KidsBookCard`, `MatchedResults`).
- "Look inside" lightbox trigger (part of hero above).
- Cart drawer (`components/CartDrawer.tsx`).
- Checkout summary (`pages/KidsCheckout.tsx`) — coloring branch.
- Download / library pages (`pages/Library.tsx`, `pages/CheckoutReturn.tsx`).
- Admin cards (`pages/admin/KidsLibrary.tsx`).
- `og:image` / `twitter:image` — served from `thumbnail_url` (square).

## Gallery composition (content-driven)

Sale page gallery is `[square_cover, ...supporting]` where supporting
slots come from `storefront_meta.gallery_urls`. Total slots: **min 4,
max 6**. Do not pad with weak filler to hit 6 — the pipeline picks per
book from: what's-inside grid, 1–2 page close-ups, print-at-home
mockup, ages/benefits card, value/page-count card.

## Do not

- Do not use `object-cover` on a coloring thumbnail — it crops the baked
  title/subject.
- Do not use `aspect-[1600/2071]` or any non-square ratio for coloring
  thumbnails (superseded — that was pre-marketing-thumbnail-v3).
- Do not introduce new coloring-thumbnail components without applying
  this law; add them to the sweep list above.

## Files touched in the 2026-07-18 sweep

- `src/pages/ColoringProduct.tsx` (hero + thumbnails + cross-sell)
- `src/components/kids/KidsBookCard.tsx` (grid card — coloring branch)
- `src/pages/KidsCheckout.tsx` (coloring branch)
- `src/components/CartDrawer.tsx`
- `src/pages/Library.tsx`
- `src/pages/CheckoutReturn.tsx`
- `src/pages/admin/KidsLibrary.tsx`
