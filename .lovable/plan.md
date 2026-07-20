
# SecretPDF Customer Accounts + Royalty Participation V1

This is a very large scope. I will build it as an **isolated module** in phases, with hard feature flags, without touching the existing book-generation, coloring, storybook, Drive-import, marketing, or PDF pipelines except through defined read-only integration points.

Before I start writing code I need you to confirm scope, because Phases 2–4 involve real money, legal, and regulated activity that I should not silently ship.

---

## Route map (new, isolated)

```text
/account
  /overview
  /library
  /orders
  /orders/:id
  /downloads
  /invoices
  /tax-profile
  /wishlist
  /notifications
  /support
  /profile
  /security
  /privacy
/royalties                (gated by royalty_catalog_visible)
  /overview
  /books
  /books/:id
  /holdings
  /earnings
  /statements
  /payouts
  /wallet
  /kyc
/admin/accounts/*         (support/finance/compliance roles)
/admin/royalties/*        (config, compliance checklist, ledger explorer, payout queue)
```

All routes live under new folders `src/pages/account/`, `src/pages/royalties/`, `src/pages/admin/accounts/`, `src/pages/admin/royalties/`. No existing route is renamed or removed.

---

## Feature flags (all default OFF except accounts)

Stored in `platform_settings` as a single JSON row:

- `customer_accounts_enabled` — Phase 1 default ON in dev, OFF in prod until you approve
- `google_login_enabled` — ON (already configured)
- `tax_invoice_enabled` — OFF until compliant e-Tax provider is wired
- `royalty_catalog_visible` — OFF
- `royalty_purchase_enabled` — OFF (hard-blocked server-side)
- `royalty_payout_enabled` — OFF (hard-blocked server-side)

Royalty program state machine stored per book: `DRAFT → LEGAL_REVIEW_REQUIRED → PROVIDERS_REQUIRED → SANDBOX → APPROVED → LIVE → PAUSED`. Default `LEGAL_REVIEW_REQUIRED`. Purchase/payout edge functions refuse unless state is `LIVE` **and** the two feature flags are true.

---

## Integration with existing system (read-only reuse)

- Reuse existing Supabase auth (Google already active), `user_roles`, `has_role()`.
- Reuse existing `orders`, `order_items`, `download_grants`, `product_pricing`, `wallets`, `wallet_transactions` where they fit; extend them additively with new columns instead of renaming.
- New tables added under clear namespaces (`acct_*`, `roy_*`, `ledger_*`) to avoid colliding with existing `rights_*` / `royalty_*` trading tables from the earlier exchange prototype. Those legacy tables stay untouched.

Conflict risks I want to flag:

1. You already have `rights_offerings`, `rights_holdings`, `rights_trades`, `royalty_holdings`, `royalty_earnings_ledger` from an earlier exchange lane. They implement a **different** model (per-share trading with treasury). I will **not** merge into them; the new module uses its own `roy_*` tables so the old prototype keeps working and can be retired later.
2. `orders` / `order_items` already exist for storefront sales. I will extend them additively (add nullable `kind` column = `book_purchase` | `royalty_unit_purchase`) rather than fork.
3. `wallets` exist for the exchange prototype (USD balance). The new payout module needs a separate `roy_wallets` (crypto payout wallet: address + network + verification) — different concept, so separate table.

---

## Phase 1 deliverables (what I'll build this turn if you say go)

Scope kept tight so it lands cleanly and safely:

1. **Account shell + navigation** (`/account/*`), responsive, using existing shadcn + design tokens. Left nav desktop, sheet menu mobile.
2. **Overview page** — greeting, verified-email banner, recent purchases (from existing `orders`), empty states.
3. **My Library** — lists `download_grants` for the signed-in user, grid/list toggle, search, filter by format/language.
4. **Downloads** — "Re-download" button that calls a new edge function `account-signed-download` which verifies entitlement server-side and returns a short-lived signed URL from storage. IDOR-safe, audit-logged into new `acct_download_events`.
5. **Orders & Purchases** — list + detail view of existing `orders` scoped by `auth.uid()`.
6. **Profile** — name, avatar, language, timezone (stored in new `acct_profiles`).
7. **Security** — sessions, "Sign out all devices", provider display. Google users see "Manage password in Google Account" link (no fake change-password form). Email/password users get real change-password + forgot-password.
8. **Privacy** — data export request (writes to `acct_data_requests`, processed manually for now), account deletion request with reauth + cooling-off (writes to `acct_deletion_requests`, no immediate destructive action).
9. **Notifications** — new `acct_notifications` table + bell UI.
10. **RLS everywhere** — every new table denies by default and scopes by `auth.uid()`; service-role only for grants/mutations that must be trusted.

Explicitly **deferred out of Phase 1**:

- Tax invoices / e-Tax provider integration (needs approved Thai e-Tax provider — I will NOT ship a homemade PDF labeled as tax invoice).
- Wishlist (nice-to-have, small; can add if you want).
- Support ticket system (can wire to existing support flow if you have one, otherwise add a minimal ticket table).

## Phase 2 (separate turn, after Phase 1 is approved)

Royalty **data model + admin config + calculation simulator + immutable double-entry ledger + read-only statements**. No live purchase, no payout. All hard-blocked server-side. This is the schema-heavy phase.

## Phase 3 (separate turn, requires legal/provider inputs from you)

KYC/KYB provider, AML/sanctions provider, licensed payment provider for unit purchase, crypto payout provider (sandbox first), reconciliation jobs.

## Phase 4

Controlled production launch behind compliance approval records. Requires you to upload legal opinions, agreement version, tax memo, etc., as records in `roy_compliance_approvals`. Flags flip only via admin action, never in code.

---

## Technical section

- **Migrations**: additive only, versioned. New tables + `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` + `GRANT ALL ... TO service_role` + RLS enabled + policies scoped to `auth.uid()` per the project rules.
- **Ledger**: `ledger_accounts`, `ledger_journals`, `ledger_entries` with a trigger enforcing `SUM(debit) = SUM(credit)` per journal and blocking `UPDATE`/`DELETE` on posted entries for non-service roles. Amounts stored as `BIGINT` minor units + `currency TEXT`, never floats.
- **Idempotency**: every payment webhook and checkout endpoint takes an idempotency key with a unique index; duplicate deliveries return the original result.
- **Signed downloads**: edge function checks `download_grants` for `(user_id, product_id, active, not_expired)`, then creates a 5-minute signed URL from `ebook-pdfs`. Never trusts a URL passed from the client.
- **Google users password UX**: read `auth.identities` for the current user; if provider = `google` and no `email` identity, hide the password form entirely.
- **Royalty math (Phase 2, not shipped yet)**: integer-minor-unit decimal, tax-inclusive vs exclusive both supported, `DNR = gross − refunds − chargebacks − tax_due − actual_processor_fee − permitted_deductions`, `holder_share = DNR × units / 100`, rounding + residual-cent allocation rule documented and unit-tested. No hard-coded 7%.
- **Compliance gates**: purchase and payout edge functions check `roy_programs.state = 'LIVE'` **and** `platform_settings.royalty_purchase_enabled = true` (or `payout_enabled`) **and** all required `roy_compliance_approvals` present. Missing any → 403 with truthful reason. No bypass path.
- **Tests (Phase 1)**: RLS cross-user access, IDOR on download URL, duplicate webhook grant, Google-user password form hidden, sign-out-all-devices, keyboard nav on library.

---

## What I need from you before proceeding

1. **Confirm phased approach** — I ship Phase 1 now (accounts + library + downloads + orders + profile + security + privacy + notifications). Phases 2–4 in separate turns.
2. **Confirm additive integration** — I will NOT merge into legacy `rights_*` / `royalty_*` exchange tables; the new module uses its own `roy_*` namespace. OK?
3. **Confirm tax-invoice deferral** — no e-Tax invoice UI in Phase 1 (waiting on approved provider). OK?

Reply "go phase 1" and I start with the migration + account shell in the next turn.
