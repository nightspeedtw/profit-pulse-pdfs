
# Mobile Conversion Optimization — ColoringProduct

Scope: `src/pages/ColoringProduct.tsx` and a few new small components. Visual identity (SecretPDF Kids brutal-card look, semantic tokens) preserved. No pricing logic changes — CTA copy uses live `priceText`; the "$14.99" in the spec is illustrative and will be whatever the book's actual price is.

## 1. Hero (mobile-first, above the fold)

Reorder for `<md`:
1. Large cover image (already aspect-square).
2. **B&W notice pill** directly under cover: "Interior pages are black-and-white coloring designs, ready to print at home."
3. Title + age/pages/format value chips consolidated into one line: `82 unique pages · Ages 4–8 · A4 + US Letter · Instant PDF`.
4. Price block (existing `deriveSalePricing`).
5. **Primary CTA** — replace copy:
   - Label: `Start Coloring Today — {priceText}`
   - Sub-line beneath: `Instant download • Print at home • {pageCount} unique pages`
6. **Secondary CTA** (outline style): `Preview 5 Free Coloring Pages` → opens an email-capture modal, then triggers sample PDF download.
7. Trust row (rewritten, truthful, see §4).

Existing thumbnail strip + "Look inside" button move below the CTA stack on mobile to keep the fold conversion-focused. Interior preview thumbnails (4 small B&W samples) also appear directly under the notice pill so the user *sees* B&W previews before scrolling.

## 2. Bundle offer — promoted directly below primary CTA

Move `<CompleteTheSetBundle>` out of the bottom of the page and mount it right after the CTA block on mobile (still shown in current position on desktop, or unified). Redesign the card:
- `BEST VALUE` badge (accent chip, existing token palette).
- Row: total pages across bundle, original combined price (strikethrough), bundle price, exact savings in USD.
- CTA: `Get the Bundle & Save {discountPct}%`.
- Keeps the existing `free-download` invocation logic — visual redesign only.

## 3. Value section cleanup

- Remove the duplicated `HighlightsBlock`, "Why parents love it" 3-card grid, and `ItemDetailsSection` on mobile (kept on desktop via `hidden md:block`), OR collapse them into a single "What You Get" card.
- New **What You Get** card (single bordered block, larger text) listing:
  - `{pageCount} unique pages, no repeats`
  - `Ages {ageMin}–{ageMax}`
  - `A4 + US Letter, print-ready PDF`
  - `Less than {perPageCents}¢ per page` (computed = `Math.round(priceCents / pageCount)`; only shown when result > 0)
  - `Personal + classroom use`
- Bump body text from `text-xs/text-sm` to `text-sm/text-base` on mobile; reduce bordered-card density.

## 4. Trust elements (truthful only)

New `<PurchaseTrustRow />` near CTA, three items — no reviews, no scarcity, no sales counts:
- `Print-ready PDF, checked before release`
- `Secure checkout`
- `Help with technical download issues` (mailto link to existing support address)

Remove `<SocialProofBadges>` from above-the-fold on mobile (kept lower on desktop) if it renders invented counts — if it only renders real data, leave it below the fold.

## 5. Free-preview email capture

New component `<FreeSamplePreviewModal />`:
- Small form: email input + submit.
- On submit: inserts into a new lightweight table row (`sample_leads`: `email`, `ebook_id`, `created_at`) via existing supabase client, then calls the existing `free-download` function with a `sample=true` flag (or falls back to constructing a client-side PDF of the first 5 `previewUrls` — MVP uses the direct sample URL from `meta.sample_pdf_url` if present, else the first 5 preview images shown in a lightbox as a printable web view).
- No email deliverability needed for v1 — success screen shows a `Download 5-page sample` button that triggers the sample.
- Backend addition is minimal (one table + insert policy). Confirming with user whether that's in scope — if not, we skip DB insert and just gate the sample behind email entered locally.

## 6. Sticky mobile buy bar

Update the existing `md:hidden` sticky bar copy:
- Left: `{priceText}` + `{pageCount} pages · Ages X–Y` (unchanged).
- Button label: `Get the Book — {priceText}` (instead of "Download").

## Technical details

Files:
- `src/pages/ColoringProduct.tsx` — reorder hero, swap CTA copy, add per-page calc, add responsive `hidden`/`md:block` wrappers around removed-on-mobile sections, move bundle mount point.
- **New** `src/components/product/BWPreviewNotice.tsx` — pill component.
- **New** `src/components/product/WhatYouGetCard.tsx` — consolidated value card.
- **New** `src/components/product/PurchaseTrustRow.tsx` — 3-item trust row.
- **New** `src/components/product/FreeSamplePreviewModal.tsx` — email capture + sample delivery.
- Edit `src/components/product/CompleteTheSetBundle.tsx` — add BEST VALUE badge, restructure price row, update CTA copy to include discount %.

No changes to pricing/data logic, backend functions, or the payment path. Colors stay on semantic tokens (`bg-foreground`, `bg-accent`, `border-foreground`, `bg-highlight`).

## Open question for you

For "Preview 5 Free Coloring Pages" — do you want:
- **(a)** true email capture (creates a `sample_leads` table + sends an email later via Resend), or
- **(b)** frictionless: enter email → immediately reveal a download link for the first 5 preview pages (email stored client-side only, no DB, no send)?

I'll default to **(b)** unless you say otherwise, since it's shippable now without backend work.
