## Goal
Ocean Friends Coloring Adventure (Ages 4-6) sale page shows the cover cropped because Product.tsx forces `aspect-square` on kids items — but square is the picture-book shape. Coloring books are 8.5×11 portrait (1600×2071 native, 600×776 thumb). Fix the sale-page thumbnail aspect for coloring books, and regenerate a fresh cover for this book so the PDF/sale page uses a clean new artwork.

## Scope
Two changes:
1. **Sale-page thumbnail aspect fix (permanent, all coloring books).**
2. **Regenerate cover + PDF for Ocean Friends Coloring Adventure (`a05a5086-8972-4b9e-8953-ee9dfa633d64`).**

Storefront card grid (`/kids`) is already fine per screenshot — no change there.

---

## Change 1 — Portrait aspect for coloring books on `/product/:id`

### Files
- `supabase/functions/list-storefront/index.ts` — kids branch (line ~200): add `book_type: kid.book_type` to the returned payload so the client can tell coloring books apart from picture books.
- `src/lib/storefront.ts` — add `book_type?: string | null` to `StorefrontEbook`.
- `src/pages/Product.tsx` — line 101 cover container:
  - `coloring_book` → `aspect-[17/22]` (matches native 8.5×11 = ColoringProduct's `1600×2071` container).
  - Other `children_illustrated` (picture books) → keep `aspect-square`.
  - Adults → keep `aspect-[3/4]`.
  - Keep `object-cover`; with the correct aspect there's no crop.

Detection rule: `product.book_type === 'coloring_book'`. No square fallback for coloring books.

## Change 2 — Regenerate Ocean Friends cover + PDF

Sequence (uses existing pipeline, no new code):
1. Clear `cover_url`, `thumbnail_url`, `metadata.coloring_cover`, `pdf_url`, `pdf_sha256` on `a05a5086-8972-4b9e-8953-ee9dfa633d64`.
2. Set `metadata.focus_run=true` and `metadata.qc_mode_override='learning'` (owner-approved Round 1 mode).
3. Invoke `coloring-book-cover` (interior-first law: uses already-rendered interior pages 6/7/8 as Ideogram 3.0 reference — book already has 32 rendered interiors).
4. Chain: cover → thumbnail (600×776) → assemble (fresh PDF with new cover fit-CONTAIN) → publish.
5. Verify: `cover_used_interior_refs=true`, `pdf_url` refreshed, `listing_status='live'`, `sellable=true`.

No threshold lowered, no gate bypassed — same publish-contract path all recently-fixed books used.

## Verification
- Reload `/product/a05a5086-...` → cover renders full 8.5×11 portrait, no crop.
- Reload `/product/<any picture book>` → still square.
- Reload `/product/<adult PDF>` → still 3/4.
- Download PDF → cover is the newly-generated artwork.

## Out of scope
- Storefront grid card aspect (already correct per screenshot).
- ColoringProduct.tsx (already uses `1600/2071` container).
- Any threshold, QC gate, or contract change.
