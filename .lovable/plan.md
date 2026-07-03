## Goal
Kill the Shopify dependency entirely. Replace it with a native storefront on this app: product listings pulled from the `ebooks` table, cart, Stripe Checkout for payment, order records, and secure signed-URL PDF delivery to the buyer. No more Shopify tokens, no more push-to-Shopify, no more "invalid_config" errors blocking the pipeline.

## What we keep from what already exists
- All ebook generation, cover, PDF render, QC, autofix — untouched.
- `ebooks` table already has `title`, `product_description`, `price`, `cover_url`, `pdf_url`, `seo_title`, `seo_meta`, `tags`, `shopify_title`, `body_html`. We reuse these as native product fields.
- Existing pages: `Index`, `Category`, `Product`, `Bundles`, `Download`, `Library`, `CartDrawer`, `ProductCard`, `cartStore` (Zustand). Wire them to `ebooks` instead of Shopify.
- Storage bucket `ebook-pdfs` (private) is already used for secure download.

## New pieces

### 1. Feature flag flip
- `src/config/features.ts` + `supabase/functions/_shared/features.ts`: `SHOPIFY_UPLOAD = false`, add `NATIVE_STOREFRONT = true`.
- Preflight stops requiring `SHOPIFY_ADMIN_TOKEN`.
- Autopilot pipeline final step becomes `mark_listed_for_sale` (flips `ebooks.status = 'published'` + `listed_at = now()`) instead of Shopify push.

### 2. Database (single migration)
- `orders` — id, buyer_email, buyer_user_id (nullable), stripe_session_id, stripe_payment_intent, amount_total, currency, status (`pending|paid|refunded|failed`), created_at, paid_at.
- `order_items` — id, order_id, ebook_id, unit_price, title_snapshot, cover_snapshot.
- `download_grants` — id, order_id, ebook_id, buyer_email, token (uuid), expires_at, download_count, max_downloads (default 5), last_downloaded_at.
- Add to `ebooks`: `listed_at timestamptz`, `sales_count int default 0`.
- RLS + GRANTs per house rules. Buyers read only their own orders/grants (by `auth.uid()` or by signed token for guest checkout).

### 3. Edge functions (new)
- `create-checkout` — body `{ ebook_ids: string[], buyer_email? }`. Loads ebooks, builds Stripe Checkout line items from `title` + `price` + `cover_url`, `mode: 'payment'`, returns `{ url }`. Guest checkout allowed.
- `stripe-webhook` — verifies signature, on `checkout.session.completed` creates `order` + `order_items` + one `download_grant` per item (7-day expiry, 5 downloads), then calls Resend/Lovable email to send the download links. `verify_jwt = false` in config.toml.
- `download-ebook` — body `{ token }`. Validates grant (not expired, count < max), increments counter, returns signed URL from `ebook-pdfs` bucket (10-min TTL).

### 4. Payments
- Use Stripe via the `stripe--enable_stripe` connector (public key in code, secret key auto-provisioned in edge env). No manual token juggling. If user prefers Paddle, we can swap — Stripe is default because digital-goods checkout + tax handling is turnkey.

### 5. Emails
- `SendReceipt` transactional email via the seamless-email flow: subject "Your download is ready", body with per-item download link `/download?token=…`. Falls back to on-screen success page with same links if email fails.

### 6. Frontend
- `Index` + `Category` + `Bundles`: fetch published ebooks (`status='published'` OR `listed_at IS NOT NULL`) from Supabase, render existing `ProductCard`.
- `Product` (`/product/:handle`): resolve by `url_slug` or `id`, show cover, title, price, `body_html`, "Add to cart" button. No fake reviews.
- `CartDrawer`: existing Zustand cart; "Checkout" button posts cart to `create-checkout` and redirects to Stripe URL.
- `Download` (`/download?token=…` and `?session_id=…`): shows per-item download buttons that call `download-ebook` and open the signed URL.
- `Library` (authenticated users): lists their past orders + still-valid download grants.
- `Header`: cart icon with count, sign-in link.

### 7. Admin
- `/admin/production` "Ready to Publish" section: replace "Push to Shopify" button with **"List for sale"** (flips `listed_at`) and **"Unlist"**. Remove `ReadyShopify` route + `ShopifyStatus` + `EbookShopify` page from nav (keep files archived under `src/_archive/` so nothing else breaks).
- `/admin/orders` (new small page): list of paid orders, buyer email, item, amount, refund link (calls Stripe refund via new edge function `refund-order`).

### 8. Cleanup
- Guard all `push-to-shopify`, `shopify-publish`, `shopify-draft-upload`, `shopify-test-connection`, `generate-shopify-package` edge functions with `if (!FEATURES.SHOPIFY_UPLOAD) return 410 Gone`. Do NOT delete — leave for a possible future re-enable.
- Remove `ShopifyStatus`, `ReadyShopifyCard`, Shopify nav link, Shopify buttons in `LiveProductionQueue`/`FinalApproval` from the render tree.

## Out of scope for this pass
- No coupons/discount codes (add later).
- No subscriptions — one-off digital purchases only.
- No affiliate tracking, no reviews, no wishlist.
- No physical shipping (digital only).
- No multi-currency beyond Stripe's built-in presentment.

## What I need from you before I start building
1. **Payment provider** — go with **Stripe** (default, easiest for digital goods)? Or Paddle (better if you want them to handle sales tax/VAT as merchant of record)?
2. **Guest checkout** — allow buying without an account (email-only, download link mailed), or require sign-in first?
3. **Store brand** — keep the current site brand (SecretPDF / Printly is referenced in code) or change the vendor name shown on the storefront?

Once you answer those three, I'll execute this plan in build mode: migration → Stripe connector → 3 edge functions → storefront rewrite → admin cleanup → end-to-end test with one of the two ready books.
