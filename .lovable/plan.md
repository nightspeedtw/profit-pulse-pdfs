# Ready to Shopify — Sidebar Page

Add a new dedicated admin page that shows every ebook that has finished production (PDF + QC gates passed) but is not yet uploaded to Shopify, with the full product package (thumbnail, title, price, hook, description) rendered per the Shopify Product Expert master skill, and a one-click **Add to Shopify** button.

## 1. Sidebar entry

Edit `src/pages/admin/AdminLayout.tsx` — add nav item between Production and Products:

```
{ to: "/admin/ready-shopify", label: "Ready to Shopify", icon: Rocket }
```

Register route in `src/App.tsx` → `/admin/ready-shopify` → new `ReadyShopify` page.

## 2. Data source

Reuse existing `admin-data` edge function `live_queue` resource — it already returns a `ready_to_publish` array (100% complete, PDF ready, `shopify_status !== 'published'`), enriched with `qc`, `cover_url`, `final_quality_score`, `word_count`.

Extend the `cols` select in `supabase/functions/admin-data/index.ts` (live_queue ready branch only) to also include product-copy / pricing fields already stored on `ebooks`:

- `thumbnail_url` (premium book mockup, falls back to `cover_url`)
- `shopify_title`, `shopify_subtitle`, `short_hook`, `body_html`
- `benefit_bullets`, `whats_inside`, `who_its_for`, `who_its_not_for`
- `price`, `compare_at_price`, `launch_price`, `price_tier`
- `seo_title`, `meta_description`, `url_slug`, `tags`
- `pricing_confidence_score`, `product_page_qc_score`, `thumbnail_qc_score`
- `shopify_product_id`, `shopify_status`

If any of those columns don't yet exist on `ebooks`, add a migration that adds them as nullable (JSONB for arrays, text/numeric for scalars) — no destructive changes.

## 3. New page: `src/pages/admin/ReadyShopify.tsx`

Layout: header + grid of product cards, one per ready ebook.

Each card shows:

- Large thumbnail (`thumbnail_url` → book-mockup, fall back to `cover_url`), aspect 3:4
- Product title (`shopify_title` or fallback ebook title)
- Subtitle / short hook
- Price display: `price` bold + `compare_at_price` strikethrough if present + tier chip
- QC chip row via existing `QcGateCard` — must show green for: `thumbnail_qc_score`, `product_page_qc_score`, `pricing_confidence_score`, plus premium gates already there
- Collapsible "Product Copy Preview" panel:
  - Hook paragraph
  - Benefits bullet list
  - What's Inside bullet list
  - Who it's for / Who it's not for
  - SEO title + meta description + slug
  - Tags row
- Action row:
  - **Add to Shopify** (primary) — disabled unless all required gates pass and `shopify_product_id` is null
  - **Regenerate Copy** (secondary) — calls `autofix-action` with `action: "regenerate_product_copy"`
  - **Regenerate Thumbnail** (secondary) — calls `autofix-action` with `action: "regenerate_thumbnail"`
  - **Download PDF** (ghost) — existing `downloadAdminPdf` helper
  - **Open Detail** → `/admin/ebook/:id/shopify`

Filters at top: All / Ready (all gates ≥ target) / Blocked (missing copy or failing gate) / Already uploaded (draft exists).

## 4. Add to Shopify button

Invokes existing `shopify-draft-upload` edge function:

```ts
supabase.functions.invoke("shopify-draft-upload", { body: { ebook_id } })
```

Optimistic UI: mark card as "Uploading…", poll `admin-data` on success, show toast with returned `shopify_draft_url`. On failure surface structured error and offer retry.

Guardrail (client-side mirror of server rule from Product Expert skill): button is disabled until all of the following are true:
- `pdf_url` present
- `thumbnail_qc_score ≥ 90`
- `product_page_qc_score ≥ 90`
- `pricing_confidence_score ≥ 85`
- `compliance_score ≥ 90` (from `qc`)
- No `needs_admin_attention` / `needs_code_fix` status

If disabled, tooltip explains exactly which gate is blocking, with quick "Auto Fix" button per failing gate (reuse existing `AutoFixChip`).

## 5. Auto-populate missing product copy

If a ready ebook has no `shopify_title` / `body_html` / `price` yet, card shows a "Generate Shopify Package" primary action instead. It calls a new lightweight endpoint (or existing `product-copy` step) to synthesize copy + price using the Shopify Product Expert prompt. Package generation:

- If a `product-copy` edge function already exists, invoke it.
- Otherwise, add `supabase/functions/generate-shopify-package/index.ts` that calls the AI gateway with the master skill prompt, returns the structured JSON from Part 10 of the skill, writes it back to `ebooks`, and triggers Product Page QC.

Regardless of path, generation runs the same auto-fix loop the pipeline already uses (max 3 attempts per failing bucket).

## 6. Technical details

Files added:
- `src/pages/admin/ReadyShopify.tsx`
- `src/components/admin/ReadyShopifyCard.tsx` (card component)
- (optional) `supabase/functions/generate-shopify-package/index.ts` + config entry

Files modified:
- `src/pages/admin/AdminLayout.tsx` — new nav entry
- `src/App.tsx` — new route
- `supabase/functions/admin-data/index.ts` — extend `cols` for ready branch, no schema break

Files reused (no change):
- `supabase/functions/shopify-draft-upload/index.ts`
- `supabase/functions/autofix-action/index.ts`
- `src/components/admin/QcGateCard.tsx`, `AutoFixChip.tsx`
- `src/lib/adminData.ts`, `downloadAdminPdf`

## 7. Out of scope

- No changes to pipeline ordering or QC thresholds — this page only surfaces already-produced assets and triggers the existing Shopify upload path.
- No auto-publish — draft only, matching current Settings toggle.
- No new tables; only additive nullable columns on `ebooks` if any product-copy fields are still missing.
