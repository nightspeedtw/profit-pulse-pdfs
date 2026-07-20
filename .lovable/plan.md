## Phase 2 — Royalty Participation V1 (Data Model + Immutable Ledger + Admin Config)

Hard-blocked from live purchase/payout. Backend infrastructure only. No customer-facing "buy shares" UI yet.

### Scope

**In scope**
- Namespaced tables for royalty holdings, per-book royalty pools, and an append-only double-entry ledger
- Calculation engine (edge function) that turns a completed order into royalty accrual entries for shareholders
- Admin config UI at `/admin/royalty-config` to enable royalty per book, set pool size, price per share, and reserve
- Global kill switch (`platform_settings.royalty_live=false`) enforced by every mutation path
- Read-only "My Royalties" page under `/account/royalties` showing holdings + accrued (unpaid) earnings

**Out of scope (Phase 3+)**
- Buying shares with real money
- KYC/AML
- Payouts (crypto or fiat)
- Tax invoices
- Secondary trading UI

### Data model (new tables, all `roy_` prefix to avoid legacy `rights_*` / `royalty_*` collisions)

- `roy_book_config` — per-book: `book_id`, `book_kind` (`adult`|`kids`|`coloring_v2`), `enabled`, `total_shares`, `price_per_share_cents`, `reserve_shares`, `royalty_pct_of_net` (share of net revenue paid to shareholders, default 20%)
- `roy_holdings` — `user_id`, `book_id`, `book_kind`, `shares`, `avg_cost_cents`; unique on (user_id, book_id, book_kind)
- `roy_ledger` — append-only double-entry. Columns: `entry_id`, `txn_id` (groups paired entries), `account_type` (`shareholder_accrued`|`platform_reserve`|`pool_income`|`payout_pending`), `user_id` (nullable), `book_id`, `book_kind`, `direction` (`debit`|`credit`), `amount_cents`, `currency`, `source` (`order`|`adjustment`|`payout`), `source_ref`, `memo`, `created_at`. No updates, no deletes.
- `roy_accrual_summary` — materialized per (user_id, book_id) rollup refreshed by the engine (fast read for account UI)

All tables: RLS on. Holdings + summary readable by owner. Ledger readable only by admins. Config writable only by admins. Grants per rules.

### Calculation engine

- Edge function `royalty-accrue-order` invoked (a) by an order-completion trigger stub and (b) manually from admin for backfill
- Input: `order_id`
- For each line item where the product has an active `roy_book_config`:
  - Compute `net_revenue = gross - refunds - processor_fees - platform_take`
  - `pool_amount = net_revenue * royalty_pct_of_net`
  - Distribute pool pro-rata across `roy_holdings.shares / total_shares` (reserve shares stay with platform)
  - Insert paired ledger entries (`pool_income` debit, `shareholder_accrued` credits per holder) inside a single txn
  - Refresh `roy_accrual_summary` rows touched
- Idempotent: unique index on (`source`, `source_ref`) so re-invoking the same order is a no-op

### Kill switch

- `platform_settings.royalty_live boolean default false`
- Every write path checks it; when false, the engine records a `skipped` audit row instead of mutating the ledger
- Admin config UI shows a red banner when `royalty_live=false`

### Admin UI (`/admin/royalty-config`)

- List of books with search + kind filter
- Per row: toggle enabled, set total_shares, price_per_share, reserve_shares, royalty_pct
- Preview panel: given a hypothetical $X net revenue, show per-share payout
- Ledger inspector tab (read-only, admin-only): filter by book, user, txn_id

### Customer UI (`/account/royalties`)

- Table of holdings: cover thumb, title, shares owned, avg cost, accrued (unpaid) earnings
- Empty state: "Royalty participation opens soon" (since buying is Phase 3)
- Seed data path: admin can grant shares manually from `/admin/royalty-config` for pilot users

### Technical details

- Migration creates tables in this order per rules: CREATE → GRANT → ENABLE RLS → CREATE POLICY
- `roy_ledger` uses a `BEFORE UPDATE OR DELETE` trigger that raises to enforce append-only
- Double-entry invariant: DB trigger asserts `sum(debit) = sum(credit)` per `txn_id` on commit (deferred constraint via trigger on `roy_ledger` after statement)
- `has_role(auth.uid(),'admin')` gates all admin policies
- Frontend uses existing `@/integrations/supabase/client`; no new dependencies

### Verification before "done"

1. Migration runs cleanly
2. `/admin/royalty-config` loads, can toggle a pilot book
3. Manually invoke `royalty-accrue-order` with a synthetic completed order id → ledger rows appear, sum(debit)=sum(credit), summary populated
4. Second invocation with same order id = no-op (idempotency)
5. `/account/royalties` shows holdings for a seeded user
6. Kill switch off blocks all accruals

Ready to build. Confirm and I'll ship the migration + engine + both UIs.
