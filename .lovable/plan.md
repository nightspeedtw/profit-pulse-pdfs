# Kids Catalog Taxonomy — Implementation Plan

Dev/frontend work. Runs in parallel with P0. No book production touched.

## 1. Data layer (migration)

Extend `ebooks_kids` with first-class taxonomy fields (nullable, backfilled):
- `age_band` text — `0-3` | `3-5` | `4-6` | `6-8`
- `book_type` text — `illustrated_storybook` | `coloring_book` (already exists via `kids_book_type` enum; expose as top-level column mirrored from metadata)
- `theme_slugs` text[] — from the 8 developmental themes
- `buyer_job_tags` text[] — `parent_calm` | `teacher` | `gift`

Backfill live rows from existing `metadata.age_band` / `kids_themes` / concept tags. Add a trigger to auto-populate on `pipeline_status → live` from concept metadata.

Seed `pipeline_skills` row `kids_catalog_taxonomy` v1 with the canonical vocab (age bands, themes, buyer-job persona hooks) so the writer + concept generator align.

## 2. Shared taxonomy module

New `src/lib/kidsCatalogTaxonomy.ts` (mirrored to `supabase/functions/_shared/kids-catalog-taxonomy.ts`):
- Canonical `AGE_BANDS`, `BOOK_TYPES`, `THEMES`, `BUYER_JOBS` arrays with slug/label/description/SEO copy.
- Category landing config: slug → `{ title_tag, meta_description, h1, intro_html, filter }`.
- Helpers: `resolveCategory(slug)`, `booksMatchingFilter(rows, filter)`, `buildKidsUrl(params)`.

Tests: `kidsCatalogTaxonomy.test.ts` — resolve, filter matching, URL round-trip.

## 3. Filter UI on /kids

Add horizontal chip filters above the grid: **Age · Theme · Type**.
- URL-param backed (`?age=4-6&theme=bedtime&type=storybook`), combinable, deep-linkable.
- Existing 3-step Journey wizard stays as the guided path (toggle above/below the grid).
- Grid re-queries `ebooks_kids` with `.contains('theme_slugs', ...)` + `.eq('age_band', ...)` + `.eq('book_type', ...)`.

## 4. Category landing pages

Route pattern: `/kids/:categorySlug` (single dynamic route, resolved from the taxonomy config).

Slugs shipped in v1:
- `bedtime-stories`, `kindness-stories`, `courage-stories`, `friendship-stories`
- `ages-0-3`, `ages-3-5`, `ages-4-6`, `ages-6-8`
- `coloring-books`
- `for-the-classroom`, `perfect-gifts`, `calmer-bedtimes` (buyer-job collections)

Each page renders:
- react-helmet-async `<Helmet>` with product-specific title tag, meta description, canonical, og:*.
- Crawlable H1 + intro paragraph (SSR-visible via Helmet + inline default in HTML for SPA readers).
- Persona hook copy for buyer-job collections.
- Filtered kids-book grid using the shared taxonomy helper.

Wire into `src/App.tsx`: `<Route path="/kids/:categorySlug" element={<KidsCategory />} />` above the catch-all.

Update `scripts/generate-sitemap.ts` (or `public/sitemap.xml`) with all landing routes.

## 5. Navigation

Update the kids section header (uses `KidsBrand` per `kids_branding` skill):
- Top nav row: Ages (dropdown: 0-3 / 3-5 / 4-6 / 6-8) · Themes (dropdown: top 4 themes + "All") · Collections (Bedtime / Classroom / Gifts) · Coloring Books.
- Mobile: collapse into a sheet.

## 6. Product cards + badges

`KidsBookCard` reads `age_band`, `book_type`, `theme_slugs` from row (not metadata). Show Age badge (primary), Type badge (secondary, only if not default storybook), Theme chip (first slug).

## 7. Verification

Playwright script `/tmp/browser/taxonomy/`:
1. Load `/kids` — screenshot filter chips.
2. Click Age=4-6 + Theme=Bedtime — screenshot URL shows `?age=4-6&theme=bedtime`, grid filters.
3. Direct-load `/kids?age=4-6&theme=bedtime` — screenshot same result.
4. Load `/kids/bedtime-stories` — screenshot H1 + intro + filtered grid + inspect `<title>`.
5. Load `/kids/coloring-books` — screenshot.
6. Load `/kids/perfect-gifts` — screenshot persona copy.

View all screenshots, confirm SEO tags in DOM, report.

## Technical detail

- Migration adds columns + backfill UPDATE using coalesce of existing metadata paths (`metadata->>'age_band'`, `metadata->'kids_themes'`, etc.). No table drops.
- No RLS change needed — new columns inherit the existing `ebooks_kids` policies.
- `react-helmet-async` already required if not installed; wire `HelmetProvider` in `main.tsx` (add if missing).
- Storefront cards continue to read from public-safe columns only.

## Deviations from spec (adapt rule)

- Spec suggested a `/kids/ages-3-5` etc. per-slug route file; using one dynamic `/kids/:categorySlug` route driven by the taxonomy config to avoid N boilerplate pages and keep SEO copy in one auditable place.
- `book_type` promoted to a real column instead of leaving it in metadata — enables Postgres-level filtering for the chip UI without JSONB scans.

## Files created / edited

Created:
- `supabase/migrations/<ts>_kids_catalog_taxonomy.sql`
- `src/lib/kidsCatalogTaxonomy.ts` + `.test.ts`
- `supabase/functions/_shared/kids-catalog-taxonomy.ts`
- `src/pages/KidsCategory.tsx`
- `src/components/kids/KidsFilterChips.tsx`
- `src/components/kids/KidsSectionNav.tsx`

Edited:
- `src/App.tsx` (route + HelmetProvider if needed)
- `src/main.tsx` (HelmetProvider)
- `src/pages/Kids.tsx` (mount filters + nav)
- `src/components/kids/KidsBookCard.tsx` (badges from columns)
- `scripts/generate-sitemap.ts` or `public/sitemap.xml`
- `.lovable/plan.md`

## Report at end

Table of routes shipped + SEO title/desc + screenshot filenames + Playwright pass/fail + migration status. Deviations logged inline.
