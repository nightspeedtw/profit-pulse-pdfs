## Goal
Turn on the Shopify push pipeline so the two QC-passed ebooks (Book 1 — Feast-or-Famine Escape Plan, Book 2 — Financial Catch-Up Protocol) can be pushed to Shopify as drafts, and future books auto-queue for upload.

## Current state (verified)
- `SHOPIFY_ADMIN_TOKEN` secret is already stored. `SHOPIFY_STORE_DOMAIN` defaults to `digital-wealth-hub-49qgj.myshopify.com` in `push-to-shopify`.
- `push-to-shopify`, `shopify-publish`, `generate-shopify-package`, `shopify-draft-upload` edge functions already exist and are complete.
- UI components (`ShopifyStatus`, `ReadyShopifyCard`, Push button in `LiveProductionQueue`) already render — they are NOT flag-gated, so the Push button is visible today. What's off:
  1. `FEATURES.SHOPIFY_UPLOAD = false` in both `src/config/features.ts` and `supabase/functions/_shared/features.ts` → autopilot pipeline skips the Shopify step, "Ready to Shopify" nav link is hidden, preflight ignores Shopify.
  2. QC gate `qc_ready_for_shopify` is true for both target books, but `pdf_qc.blocked_for_publish` may still gate the button — needs quick check.

## Plan

### 1. Flip the Phase-2 flag (both files, keep in lockstep)
- `src/config/features.ts`: `SHOPIFY_UPLOAD: true`
- `supabase/functions/_shared/features.ts`: `SHOPIFY_UPLOAD: true`

Effect: autopilot pipeline will queue Shopify draft upload after `final_pdf_ready`, preflight will require the (already-set) `SHOPIFY_ADMIN_TOKEN`, and the "Ready to Shopify" admin nav link appears.

### 2. Verify Shopify connectivity before touching data
Invoke `shopify-test-connection` once from the admin UI (or curl) to confirm the admin token + store domain still authenticate against `2025-07` API. Abort if it fails and surface the exact Shopify error to the user — do not proceed.

### 3. Ensure shopify package fields exist for both books
`push-to-shopify` reads `title`, `product_description`, `price`, `cover_url`, `pdf_url`, `seo_title`, `seo_meta`, `tags`, `vendor`, `product_type`. Check both ebooks; if any of `product_description`, `price`, `seo_title`, `seo_meta` are missing, run `generate-shopify-package` (and `compute-pricing` if `price` is null) for just those two ebook IDs. No content regen, no title/outline/cover regen.

### 4. Push each book as draft (manual, one at a time)
From `/admin/production` → "Ready to Publish" card, click "Push to Shopify" for Book 1 first, wait for `shopify_status='draft'` and confirm the admin URL opens the draft product with cover + price + description populated. Then repeat for Book 2. If push fails, read `shopify_last_error` from the event timeline and fix the specific field the API rejected — no retry loops.

### 5. Leave "Publish to live store" off
Do NOT click the `shopify-publish` button. Both books stay as **drafts** until the user reviews them in Shopify admin and explicitly approves going live.

### 6. Stale-write / lock safety
The earlier stale-writer bug was in the QC/render-pdf path, not Shopify. Still, after each push confirm `shopify_status` and `shopify_product_id` don't get overwritten by any orchestrator loop for at least 45 seconds. If they do, patch `autopilot-self-heal` to treat `shopify_status in ('draft','published')` as terminal (do not clobber).

## Out of scope
- No content, chapter, title, outline, cover, PDF, or pricing regeneration for the two target books unless step 3 finds a missing Shopify field.
- No live publish (`shopify-publish`) — drafts only in this pass.
- No SEO/blog/social flags — those stay `false`.

## Report after execution
- Flag flip confirmed in both files.
- `shopify-test-connection` result.
- Per book: `shopify_status`, `shopify_product_id`, `shopify_handle`, admin URL, any `shopify_last_error`.
- Whether autopilot pipeline now shows the Shopify step for future runs.
