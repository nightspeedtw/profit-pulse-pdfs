## Licensing Model Simplification

Replace the current pricing story with exactly two licenses per kids book and two commercial subscription plans. Everything else (bundles, sitewide sale rows, per-book campaigns) becomes secondary — the two license buttons are the primary buy path.

### 1. Data model (Cloud migration)

New tables in `public`:

- `book_licenses` — canonical per-book price rows
  - `book_id uuid` (FK ebooks_kids), `personal_price_cents int NOT NULL DEFAULT 1499`, `commercial_price_cents int NOT NULL DEFAULT 3900`, `updated_at`
  - Seeded once for every live coloring book; commercial books default to $39
- `commercial_subscriptions`
  - `id`, `user_id`, `paddle_subscription_id UNIQUE`, `paddle_customer_id`, `plan_code` (`commercial_25` | `commercial_50`), `status`, `credits_per_period int`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `environment`, timestamps
- `commercial_credit_ledger` (append-only)
  - `id`, `user_id`, `subscription_id`, `delta int` (+granted / −spent / −expired), `reason` (`period_grant` | `unlock` | `rollover_expire` | `admin_adjust`), `book_id nullable`, `expires_at` (grant only), `created_at`
  - Balance = SUM(delta) where `expires_at IS NULL OR expires_at > now()`
- `book_licenses_owned`
  - `id`, `user_id`, `book_id`, `license_type` (`personal` | `commercial`), `purchase_source` (`one_off` | `subscription_unlock`), `order_id`, `subscription_id nullable`, `commercial_rights_active bool`, `commercial_rights_last_active_at`, `granted_at`, `revoked_at nullable`
  - Unique `(user_id, book_id)` — upserts widen personal → commercial when applicable
- `download_tokens`
  - `id`, `user_id`, `book_id`, `token text UNIQUE`, `expires_at`, `used_count int`, `max_uses int DEFAULT 5`, `license_type`, `created_at`

All tables: `GRANT` block, RLS enabled, owner-only SELECT on ledger/owned/subs, service-role-only writes. `has_active_commercial_subscription(uid)` SQL function mirrors `has_active_subscription`.

### 2. Paddle catalog

Create two subscription products via the payment tools (test env, syncs to live on publish):

- `commercial_25_plan` → price `commercial_25_monthly` = $149/mo
- `commercial_50_plan` → price `commercial_50_monthly` = $249/mo

Per-book licenses stay one-time transactions handled via existing checkout — no Paddle product per book; the amount comes from `book_licenses` and is charged as a custom one-off.

### 3. Edge functions

- `paddle-webhook` — extend existing handler to recognize the two subscription prices, upsert `commercial_subscriptions`, and on each renewal insert a `+credits_per_period` grant with `expires_at = new period_end + 1 period` (rollover-one-period rule). On cancel/expire, mark `book_licenses_owned.commercial_rights_active = false` for that sub's books, keep files accessible.
- `commercial-unlock-book` — signed-in POST `{ book_id }`. Server-side: verify active sub, atomic ledger insert (−1) with row-level lock, upsert `book_licenses_owned` (commercial, `commercial_rights_active = true`). Returns updated balance + license.
- `commercial-buy-license` — issues Paddle overlay for personal ($14.99) or commercial ($39) one-off checkout; webhook then writes `book_licenses_owned`.
- `download-book` — replaces client-side signed-URL generation. Verifies `book_licenses_owned` row exists, mints a `download_tokens` row (10-minute TTL, 5 uses), returns a signed Supabase storage URL scoped to that token. Denies if no license.
- `commercial-credit-rollover-tick` — cron (hourly). Expires ledger grants whose `expires_at < now()` by inserting matching `−expired` rows. Marks `book_licenses_owned.commercial_rights_active = false` for books tied to fully-canceled subs whose period ended.
- `commercial-subscription-manage` — creates Paddle customer-portal session for upgrade/downgrade/cancel.

### 4. Frontend

**Product page (`ColoringProduct.tsx` + adult `Product.tsx`)**

- Replace the single "Get Your Coloring Book — $X" CTA with a **License Selector**:
  - Radio A: *Personal Use — $14.99* (family / household)
  - Radio B: *Commercial Activity License — $39* (educators, classrooms, camps, cafes, events)
  - Short bullet under each explaining what is / isn't allowed (matches owner spec verbatim).
- Below the selector: sticky **primary CTA** = "Buy License — $X" that opens Paddle overlay with the chosen amount.
- **Commercial upsell card** under the CTA when Commercial is selected: *"Running a business? Get 25 commercial books/month for $149 → Commercial 50 for $249. Cancel anytime."* Two plan buttons.
- **License badge** in the buy box when the signed-in user already owns the book (Personal / Commercial · Active / Commercial · Rights inactive).

**New page: `/account/commercial-library` (My Commercial Library)**

- Header: current plan, credits available, credits expiring soon (badge with date), renewal date, upgrade / downgrade / cancel buttons.
- Grid of every book the user has personal or commercial rights on:
  - Cover, title, current license type, "Rights active / inactive" pill.
  - "Unlock Commercial Rights" button (spends 1 credit) shown for Personal-only books.
  - "Download" button (calls `download-book`).
- Empty state: pitch the two commercial plans with clear feature comparison.

**Legal copy**

- Update `/legal/terms` and add a new `/legal/license` page enumerating exactly the two licenses using the owner's wording. Include the post-cancellation rule ("Files stay yours; commercial rights end after the paid period.").

### 5. Admin

New tab in existing admin under `/admin/commercial`:

- Subscriptions list (status, plan, MRR, next renewal, cancel-at-period-end).
- Credits panel per user (balance, upcoming expiry, manual `admin_adjust` action with reason).
- Claimed-books table with filters (user, book, license type, rights-active).
- Renewals + cancellations feed sourced from `commercial_subscriptions` change log.
- Per-book license status (how many personal / commercial claims).

Wired straight into the existing `admin` roles gate via `has_role('admin')`.

### 6. Sequencing

1. Migration + seeds (`book_licenses`, `commercial_*`, `download_tokens`, RLS, `GRANT`s, `has_active_commercial_subscription`).
2. Create the two Paddle subscription plans.
3. Extend `paddle-webhook`, add `commercial-*` edge functions, `download-book`, and hourly rollover cron via `pg_cron`.
4. Rebuild product-page buy box + Commercial Library page + License badge component.
5. Admin pages.
6. Legal pages + product-page copy tweaks.

### Technical notes

- Everything is scoped to the authenticated user via `auth.uid()`; no client can spend credits or upsert owned licenses — all writes route through the edge functions with `SUPABASE_SERVICE_ROLE_KEY`.
- Credit expiry is enforced by the ledger's `expires_at`, not by client math — the balance view function filters `now()`.
- Old sitewide-sale campaign rows for coloring books are frozen (no changes needed); the product page ignores them once the license selector is live so pricing shows the exact $14.99 / $39 the owner set.
- `download-book` returns a signed URL from Supabase Storage with a 10-minute TTL; the returned URL is what the browser hits — no direct storage access from the client.
- `commercial_rights_active` decouples file access (always allowed once purchased) from *commercial* use rights (only while sub is active or personal license was bought outright).

### Out of scope for this task (owner can request later)

- Migrating existing bundle / campaign discount logic to the new license model.
- Bulk gifting / classroom-code redemption.
- Team seats on the commercial plans (currently one buyer).

This plan touches ~6 new DB tables, ~5 new edge functions, ~3 new pages, and ~4 modified existing components. Ready to implement once approved.