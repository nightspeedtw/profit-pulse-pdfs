# Internal Store Standard + Daily Premium Production

Big scope. Splitting into 6 tracks. All Shopify code stays but hidden behind a feature flag; the store becomes our own internal catalog.

## Track 1 — Shopify → Internal Store

- Set `FEATURES.SHOPIFY_UPLOAD = false` (already) and add `FEATURES.INTERNAL_STORE = true`. Wrap every Shopify UI entry (`LiveProductionQueue`, `ReadyShopifyCard`, `admin/ReadyShopify`, `admin/EbookShopify`, `ShopifyStatus`) behind the flag.
- Rename buttons: "Push to Shopify" → "Publish to Store", "Shopify Draft" → "Ready for Listing", "Shopify Status" → "Listing Status".
- Pipeline stops requiring Shopify env vars; `auto-list-ebook` marks `listed_at` + `listing_status='listed'` in our DB (already the source of truth for `list-storefront`). Shopify sync becomes a no-op behind the flag.

## Track 2 — Category-aware Thumbnail Style System

- New `supabase/functions/_shared/thumbnail-style-system.ts`:
  - Category tone/palette/typography/badge/mockup style/prompt rules/forbidden list/QC thresholds.
  - Categories: `finance`, `children_illustrated`, `business_career`, `wellness_selfhelp`, `education_workbook`, `parenting_family`, `creative_hobby`, `beginner_guide`, `fiction_short`.
  - `resolveStyle(categorySlug) → StyleProfile` used by cover + thumbnail + listing copy.
- `generate-cover/index.ts`: pass resolved style profile into background + mockup prompts. Keep textless-AI rule. Text/typography overlaid app-side (already the pattern).
- QC gates per profile (title readability ≥90, click appeal ≥85, mood match ≥85). Photoreal-mockup failure falls back to flat-cover mockup scored on its own rubric.

## Track 3 — Listing Copy + Shopping-list Card

- DB migration on `ebooks` — add nullable columns:
  - `short_hook text`, `shopping_card_description text`, `long_description text`, `key_benefits jsonb`, `who_it_is_for text`, `what_you_get jsonb`, `preview_blurb text`, `listing_status text default 'draft'`, `price_rationale jsonb`, `compare_at_price numeric`, `category_slug text`.
  - (Keep existing `selling_hook`, `benefit_bullets`, `product_description` as the short-card fields already used by `ProductCard`.)
- Extend `generate-selling-copy` to fill the full listing schema in Thai, with category-aware tone and required disclaimers (finance/health/legal/parenting/children). Never guarantee outcomes.
- `list-storefront` returns the new fields; `ProductCard` + `Product.tsx` render category badge, hook, 2–3 benefit bullets, price, status.

## Track 4 — Pricing Engine

- New `supabase/functions/compute-pricing/index.ts` (or extend existing `compute-pricing`):
  - Inputs from ebook row + QC report: category, word_count, illustration_count, worksheet_count, final_quality_score, compliance flags.
  - Category bands: mini $9–17, premium $19–39, ebook+toolkit $39–79, children $7–19, bundle $79–199.
  - Output: `price`, `compare_at_price` (only if truthful and admin-enabled), `price_rationale` jsonb (factors + weights).
- Called automatically inside `auto-list-ebook` after QC. Admin can override in Ebook Detail.

## Track 5 — Daily Production Scheduler

- Extend `generation_settings` with: `daily_cost_cap`, `max_books_per_day`, `max_parallel_runs`, `category_mix jsonb`, `quality_first_mode bool`, `stop_when_failure_rate_above numeric`, `stop_when_qc_failures_exceed int`, `min_final_quality_score int`.
- Update `daily-cron` / autopilot orchestrator:
  - Compute today's capacity from cost cap ÷ avg cost/book, respecting `max_parallel_runs`.
  - Pick next ideas honoring `category_mix` weights.
  - Halt when failure rate or repeat-gate failures exceed thresholds → mark run `needs_admin_attention`.
  - Never lower QC thresholds to hit volume.
- New "Production Command Center" card in admin: capacity estimate, books today, pass rate, cost used, queued categories, Run/Pause/Resume.

## Track 6 — Admin UI

- `LiveProductionQueue`: rename Shopify actions, add "Regenerate thumbnail", "Regenerate listing copy", "Recalculate price" per row.
- New `ProductionCommandCenter.tsx` on Dashboard.
- New `InternalStoreList.tsx` (admin) showing shopping-list rows with thumbnail, title, hook, category, price, listing status, "Publish to Store".
- Ebook Detail page adds sections: flat cover, thumbnail, price + rationale, listing copy, QC report, per-action regenerate buttons.

## Backfill

One-off admin action "Refresh 2 existing QC-ready ebooks": regenerate thumbnail + listing copy + price only (no rewrite of PDF).

## Out of scope

- Rewriting existing PDFs.
- Building a customer-facing children's-book illustrator (children category will use the existing cover + storefront copy path with children profile — deep interior illustration is a follow-up).
- Removing Shopify code (kept behind flag).

## Testing

- **Existing ebook**: open Ebook Detail → "Regenerate thumbnail + listing + price" → verify DB fields populated, thumbnail matches finance profile, shopping card renders on `/`.
- **New ebook**: Run Daily Production → verify one ebook flows idea → PDF QC → cover → thumbnail (category-styled) → listing copy → auto price → `listing_status='listed'` without any Shopify call.

## Questions before I build

1. **Scope of this turn** — this is ~15–20 files + migration + 2 new edge functions. Do you want me to ship all 6 tracks now, or stage it (recommended: Tracks 1+2+3+4 first, then 5+6 next turn)?
2. **Children's-book interior illustrations** — for now, do children's ebooks use the existing text-only PDF pipeline with a children-styled cover, or should I stub a placeholder illustration step and mark it needs_admin until a real illustrator function lands?
3. **Currency** — prices in USD (current) or THB for the Thai storefront?
