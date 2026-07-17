## Permanent fix: coloring cover never gets cropped, anywhere

Two code paths still crop the 8.5:11 coloring cover. Both are fixed the same way the storefront card was: match the native aspect and use fit-CONTAIN, never fit-COVER.

### 1. Order summary thumbnail (`src/pages/KidsCheckout.tsx`)

Current (line 70-71):
```tsx
<div className="sm:w-52 aspect-square bg-muted flex-shrink-0">
  {book.cover_url && <img src={book.cover_url} … className="w-full h-full object-cover" />}
```

Change to a book-type-aware container:
- coloring books → `aspect-[1600/2071]` + `object-contain` on white bg
- picture books → keep `aspect-square` + `object-cover`

Detect via `book.storefront_meta.book_type === "coloring_book"` (already selected in the query) or by the row's `book_type` field — will add it to the select if not present.

### 2. PDF cover page (`supabase/functions/coloring-book-assemble/index.ts` ~L461–472)

Current uses `Math.max` (fit-COVER) — mathematically guarantees overflow whenever `iw/ih` isn't bit-exact with `PAGE_W/PAGE_H`. That's the source of the "Farm" letters and "Ages 4-6" badge being clipped in the PDF page 1.

Change to fit-CONTAIN on a white page:
```ts
const p = doc.addPage([PAGE_W, PAGE_H]);
p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1,1,1) }); // white letterbox
const scale = Math.min(PAGE_W / iw, PAGE_H / ih);       // was Math.max
const w = iw * scale, h = ih * scale;
p.drawImage(coverImg, { x: (PAGE_W - w)/2, y: (PAGE_H - h)/2, width: w, height: h });
```

The aspect gate already guarantees the ratio matches within 1%, so any letterbox is invisible (≤3pt). Baked title and edge characters are now mathematically impossible to clip.

### 3. Lock it with a regression test

Add `src/lib/coloringCoverPdfPlacement.test.ts` that asserts, for the assembler's placement math:
- `Math.min(PAGE_W/iw, PAGE_H/ih)` is used (fit-CONTAIN)
- for `iw,ih = 1600,2071` and page `612,792`, output width ≤ 612 and height ≤ 792
- for a hypothetical drifted raster `1620,2071`, output still fits inside the page (no overflow), while the old `Math.max` would have overflowed — proving the fix.

Extract the tiny placement helper into `_shared/coloring/pdf-cover-fit.ts` (a pure function `fitContain(iw,ih,pw,ph) → {x,y,w,h}`) so the assembler and the test both call the same code.

### 4. Backfill existing live books

No asset regen needed — the fix is display-side + PDF-assemble-side.
- Storefront/checkout thumbnails: fixed on next page load.
- PDF: re-invoke `coloring-book-assemble` for the 10 live coloring books; each will overwrite its `pdf_url` with the corrected cover page. Kick as one batch after deploy.

### 5. Memory + regressions doc

- Update `mem://design/kids-cover-prompt.md` core rule: "Any container/PDF page holding a coloring cover MUST use fit-CONTAIN (`Math.min` scale / `object-contain`). Never fit-COVER."
- Append to `.agents/skills/secretpdf-production-suite/references/known-regressions.md` and its `.claude/` mirror: "cover-crop v3 — KidsCheckout + PDF assembler" with the fixture reference.

### Files touched
- `src/pages/KidsCheckout.tsx` (thumbnail container + image classes)
- `supabase/functions/coloring-book-assemble/index.ts` (cover page placement)
- `supabase/functions/_shared/coloring/pdf-cover-fit.ts` (new pure helper)
- `src/lib/coloringCoverPdfPlacement.test.ts` (new regression test)
- `mem/design/kids-cover-prompt.md`
- `.agents/skills/secretpdf-production-suite/references/known-regressions.md` (+ `.claude/` mirror)

### Report after build
- Confirm KidsCheckout renders full cover with no crop.
- Confirm regenerated PDF page 1 shows full title + badge inside trim.
- Test suite green.
- Batch re-assemble count for live coloring books.