# Fix: Kids picture-book PDF uses wrong (business) template

## Problem

When the storefront shows a children's book (e.g. *Barnaby's Wobbly Problem*) and the user clicks to download/preview the PDF, the file is rendered with the **non-fiction business template** — 108 pages with worksheets, action plans, "Debt Tracker", "The High-Ticket Consultant's Engine" overlay text on the cover, framework diagrams, and a bonus section.

Root cause: `supabase/functions/render-pdf/index.ts` correctly detects `isKidsPictureBook(...)` and generates bible-locked interior illustrations, but then still calls the single `buildPdfHtml(data)` from `pdf-template.ts`, which only knows the business/non-fiction layout (worksheets, action plan, bonus section, cover text overlays).

## Fix

Add a dedicated **kids picture-book branch** to the PDF pipeline. Children's books get a proper storybook layout; every other category keeps the current template unchanged.

### 1. New template: `buildKidsPictureBookHtml(data)`

Add to `supabase/functions/_shared/pdf-template.ts` (new exported function, does not touch existing `buildPdfHtml`):

- **Page size**: 8.5in × 8.5in square (picture-book standard) instead of 6×9.
- **Cover page**: full-bleed `data.cover_url` image only — no "SECRET PDF" eyebrow, no "PREMIUM EDITION" badge, no white title overlay, no subtitle block. The cover art already contains the title.
- **Copyright page**: single quiet page (year + short line), no disclaimer wall.
- **Story spreads**: for each chapter, one 2-page spread:
  - Left page = full-bleed illustration from `chapter.illustration.url` (falls back to a soft cream page if missing).
  - Right page = the chapter text in large storybook typography (serif, ~18pt, generous line-height, centered block, no chapter number heading, no callouts, no worksheet, no checklist, no diagram).
- **Back page**: simple "The End" + one-line "A Bedtime Story" tag. No action plan, no bonus section, no "Let's Talk About It" template unless present in outline.
- Remove all header/footer chrome (no page numbers, no running title) — picture books don't use them.
- Reuse existing font imports and cream palette; no new dependencies.

### 2. Route in `render-pdf/index.ts`

After assembling `data`, branch on the existing `kidsBook` flag:

```ts
const html = kidsBook ? buildKidsPictureBookHtml(data) : buildPdfHtml(data);
const headerTpl = kidsBook ? "<div></div>" : buildHeaderTemplate("SECRET PDF", ebook.title);
const footerTpl = kidsBook ? "<div></div>" : buildFooterTemplate();
```

Also pass square page format to the Browserless render call when `kidsBook` is true (`format` swapped for explicit `width: "8.5in", height: "8.5in"`, `margin: 0`).

### 3. Strip business fields for kids books when assembling `data`

Inside the kids branch, force:
- `data.action_plan = null`
- `data.bonus_section = null`
- `data.bonuses = null`
- Each chapter: drop `worksheet`, `checklist`, `diagram`, `callouts` (already computed but not used by the kids template — clearing them avoids any accidental rendering).

### 4. Verification

After deploy, re-render Barnaby's PDF and confirm:
- Total pages ≈ 2 (cover + copyright) + 2 × chapters + 1 (back) — for 12 chapters, ~28 pages, not 108.
- Cover page shows only the illustrated cover, no white "THE HIGH-TICKET CONSULTANT'S ENGINE" overlay.
- Every chapter shows the badger illustration on the left, story text on the right.
- No worksheet, action plan, or bonus section pages.

## Files touched

- `supabase/functions/_shared/pdf-template.ts` — add `buildKidsPictureBookHtml` export.
- `supabase/functions/render-pdf/index.ts` — branch on `kidsBook` for HTML, header/footer, page size, and to clear business fields.

No database changes, no new dependencies, no changes to cover generation (already fixed in previous turn).
