## Goal

Every time an ebook goes live (auto-list or manual list), automatically:
1. Regenerate a **thumbnail** in the reference hardcover style (dark, dramatic side light, marble surface, spine visible, `EBOOK` chip, big condensed title with one word highlighted, hairline-ruled subtitle, central hero illustration matched to the book's topic, 4 icon+label feature chips at the bottom) — **style adapts per topic** (palette / hero metaphor / chips), not a fixed template.
2. Regenerate **selling copy** — a punchy product description with a strong hook, 3–5 benefit bullets, and a short CTA line — tuned to the buyer pain and psychological lever of that specific book.

Both regenerate on every listing event so the listed product always has the newest style + newest copy.

## What changes

### 1. `supabase/functions/auto-list-ebook/index.ts`
- Before the Stripe sync + `listed_at` update, always call:
  - `generate-cover` (force regenerate, not only when `cover_url` is missing) — passes the currently active `cover_style_reference` so the thumbnail mimics the uploaded ref image.
  - a new `generate-selling-copy` function (see #3) to refresh `product_description` (+ new `selling_hook` and `benefit_bullets` fields).
- Push refreshed `cover_url`, `product_description`, and `images: [cover_url]` to Stripe in the existing `syncStripe` step so the storefront/Stripe listing reflects the new thumbnail immediately.
- Log both steps to `pipeline_step_logs`.

### 2. `supabase/functions/generate-cover/index.ts` (already reads active style ref)
- Confirm it always emits a fresh **photoreal thumbnail** (not just the flat cover) using the reference-style mockup, per book topic. Tighten the mockup prompt so it fails QC when the returned image is a light/studio background or has no visible spine.
- Accept a `force: true` flag from `auto-list-ebook` so it re-runs even if `cover_url` already exists.

### 3. New `supabase/functions/generate-selling-copy/index.ts`
- Input: `ebook_id`.
- Loads title, subtitle, category, buyer avatar, psychological lever, top pain, promised transformation from the ebook's `CoverSpec`/metadata.
- Calls `google/gemini-2.5-pro` (Lovable AI) with a copywriter system prompt that enforces:
  - 1 strong **selling hook** (≤ 12 words, curiosity + pain + promise).
  - 3–5 **benefit bullets** (outcome-first, no fluff).
  - 1 short **product description** paragraph (≤ 60 words) ending in a CTA.
  - Tone matched to the lever (Control / Pain Relief / Identity / Status / Certainty / Belonging).
- Writes back to `ebooks`: `product_description`, `selling_hook`, `benefit_bullets` (jsonb).

### 4. DB migration
- Add `selling_hook text` and `benefit_bullets jsonb` to `public.ebooks` (nullable, no RLS change).

### 5. Storefront display (`src/pages/Product.tsx` + `src/components/ProductCard.tsx`)
- Show `selling_hook` above the title on the product page.
- Show `benefit_bullets` as a checkmark list under the description.
- No layout redesign — just render the new fields if present, fall back to current behavior if empty.

### 6. Admin UI (`src/components/admin/LiveProductionQueue.tsx`)
- Rename the existing "Regenerate cover" button to "Regenerate thumbnail + copy" so admins can trigger the same refresh manually.
- Bulk button already exists — extend it to also refresh copy for all listed ebooks.

## Out of scope

- PDF interior, pricing, checkout, download flow.
- Non-ebook product types.
- Redesigning storefront layout.

## Questions before I build

1. **Copy language** — should selling hook + description + bullets be **Thai** (matching your message), **English** (matching current product data), or **both** (store `_th` and `_en`)?
2. **Regenerate on every re-list, or only first time?** If an admin manually re-lists a book after editing its title, do you want the copy + thumbnail forcibly refreshed every time, or only when they're empty / older than X days?
3. **Selling hook placement on the storefront** — above the title as a small yellow "eyebrow" line (matches your reference hardcover accent), or as a large tagline under the title?
