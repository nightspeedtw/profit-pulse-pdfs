# Paddle Checkout & Fulfillment Plan

## Catalog strategy (per owner directive)

Paddle will **not** hold 600+ per-book prices. Instead:

- **One dynamic product**: `digital_download` — passed a custom `unit_price` at checkout equal to the resolved final price from `product_pricing` (after campaign discounts, promo codes, bundles). Paddle charges exactly what the customer sees.
- **Three subscription tiers** (credit allowance model): `kids_starter` (10 credits/mo, $4.99), `kids_pro` (30 credits/mo, $9.99), `kids_unlimited` (100 credits/mo, $19.99). Yearly variants at ~2 months free.

All prices created via `create_product` in sandbox — auto-synced to live on publish.

## Checkout flow (one-time books)

1. User clicks "Buy" on a book card / product page.
2. Frontend calls new edge fn `resolve-checkout-price` with `{ bookId, promoCode? }` → returns `{ finalCents, breakdown, checkoutToken }`. Token is a short-lived signed JWT binding `userId + bookId + finalCents + expiresAt` (5 min).
3. Frontend opens Paddle overlay with `items:[{priceId: digital_download_dynamic, quantity:1}]` + `customData:{ userId, bookId, checkoutToken }`.
4. Because Paddle can't accept arbitrary unit prices on a fixed price, the dynamic product is created as a **pay-what-you-want** style price with `custom_amounts:true`; the token amount is passed via `items[].price` override.
5. Webhook `transaction.completed` verifies token, then fulfills.

## Cart support

New `checkout_carts` table for multi-item purchases (bundle several books into one Paddle transaction, one line per book with its own resolved price).

## Fulfillment (on `transaction.completed`)

Handler runs inside existing `payments-webhook`:
1. Verify token, decode `bookId`(s) + `userId`.
2. Insert `orders` + `order_items` rows (uses existing tables).
3. For each book: `INSERT INTO download_grants (user_id, book_id, source='purchase', expires_at=null)`.
4. Send Resend email with 24h signed URL to the PDF (reuses `account-signed-download` logic).
5. Call `royalty-accrue-order` (respects `platform_settings.royalty_live` gate).

## Subscription flow (credit allowance)

Tables:
- `subscriptions` (existing schema from Paddle knowledge) — add `credits_per_period int` and `credits_reset_at timestamptz`.
- Reuse `wallet_transactions` with new `type='sub_credit_grant'` / `type='sub_credit_spend'`.

Webhook events:
- `subscription.created` → row + insert initial credits into wallet.
- `subscription.updated` → on period rollover (new `current_period_start`), grant new credits; **do not carry over** unused credits (expire at renewal).
- Plan upgrade: prorated immediately via Paddle (`prorationBillingMode: 'prorated_immediately'`); on webhook, grant the *difference* in credits pro-rated to remaining period.
- Plan downgrade: same — prorated immediately, credits recomputed.
- `subscription.canceled` → keep access + remaining credits until `current_period_end`.

Redemption:
- Downloading a book while sub-active either (a) uses a subscription credit (deducts 1 from wallet) or (b) if no credits, offers one-time purchase.
- `has_active_subscription(uid, 'live')` gates the redemption edge fn.

## Frontend

- `<BuyBookButton book={} />` component drop-in used on `KidsBookCard`, `ColoringProduct`, drive product pages.
- `/account/library` gets "Credits remaining: X / Y (resets Aug 20)" banner and "Redeem with credit" vs "Buy for $X.XX" split buttons.
- `/pricing` page listing the 3 subscription tiers (monthly/yearly toggle).
- `PaymentTestModeBanner` at top of every page in preview.

## Technical section

### New / changed files

Backend (`supabase/functions/`):
- `_shared/paddle.ts` — canonical Paddle client (from knowledge)
- `_shared/checkout-token.ts` — HMAC-signed token helper
- `resolve-checkout-price/index.ts` — reads `product_pricing`, applies promo, returns token
- `get-paddle-price/index.ts` — resolves human-readable → Paddle internal ID
- `payments-webhook/index.ts` — handles txn + subscription events, fulfillment
- `redeem-credit-download/index.ts` — spends 1 credit → returns signed PDF URL
- `create-portal-session/index.ts` — Paddle customer portal link

Frontend:
- `src/lib/paddle.ts` — SDK init, env detection
- `src/hooks/usePaddleCheckout.ts`
- `src/hooks/useSubscription.ts` — env-filtered query + credits
- `src/components/PaymentTestModeBanner.tsx`
- `src/components/BuyBookButton.tsx`
- `src/pages/Pricing.tsx`
- Update `KidsBookCard`, `ColoringProduct`, `AccountLibrary`

### DB migrations
- `subscriptions` table (Paddle knowledge schema) + `credits_per_period`, `credits_reset_at`
- `checkout_tokens` table (used-once ledger, for replay protection)
- `download_grants` — add `source text` if missing
- `has_active_subscription(uid, env)` fn (from knowledge)
- Extend `wallet_transactions.type` allowed values

### Paddle products (created via `create_product` in sandbox)
- `digital_download` / `digital_download_dynamic` (one-time, custom amount)
- `kids_starter` → `kids_starter_monthly` ($4.99) + `_yearly` ($49)
- `kids_pro` → `kids_pro_monthly` ($9.99) + `_yearly` ($99)
- `kids_unlimited` → `kids_unlimited_monthly` ($19.99) + `_yearly` ($199)

### Security
- `checkout_token` HMAC-signed with `PAYMENTS_SANDBOX_WEBHOOK_SECRET` scope-key; single-use enforced by insert-on-verify in `checkout_tokens`.
- Webhook writes go through `service_role` only. Users read own subs/grants via RLS + `auth.uid()`.
- `redeem-credit-download` requires JWT, re-validates active sub + wallet balance atomically.

### Rollout order

1. Migrations + Paddle products
2. Backend edge fns + webhook
3. Frontend SDK + banner + BuyBookButton on one card
4. Pricing page + subscription flow
5. Wire remaining cards + library credits UI

Ready to build — reply "go" to start with step 1.
