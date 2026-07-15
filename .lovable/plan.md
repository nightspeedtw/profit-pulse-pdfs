# Royalty Ownership (buy-only, simulated)

Supersedes the earlier /exchange + /rights builds. Prior tables/functions are reused where compatible; the order-book / sell UI is removed from the surface (tables kept for later phase, unreferenced).

## Reconciliation with existing work

Kept & remapped (schema exists, semantics compatible):
- `rights_offerings` → treated as the underlying market row (1M units, treasury). We add a thin `book_royalty_markets` view/table that maps 1:1 by `book_id` and carries the new admin-editable fields (royalty_pool_percent, thai_vat_rate, gateway_fee_rate, initial/indicative values, minimum_purchase).
- `rights_holdings` → renamed-in-UI to Royalty Holdings; add derived columns (`total_vat_usd`, `total_gateway_fee_usd`, `total_paid_usd`, `lifetime_royalty_earned`, `pending_royalty`) via a new `royalty_holdings` table that this phase writes to. `rights_holdings` continues to exist for the (dormant) sell path.
- `rights_price_history` → reused for `book_valuation_snapshots` (add columns; keep row shape backward-compatible).
- `wallets` / `wallet_transactions` → kept but Buy button no longer debits them (see Purchase flow).

Removed from UI (rows preserved, code hidden):
- `SellPanel`, `OrderBook` components — deleted from routes but files kept unreferenced.
- `exchange-sell-list`, `exchange-cancel-order` edge functions — remain deployed but no UI links.
- The wallet top-up flow — hidden behind admin-only route.

## New DB tables (migration, all with GRANTs + RLS)

- `book_royalty_markets` (id, book_id UNIQUE, total_units=1000000, units_available, initial_book_value_usd=1000, initial_unit_price_usd=0.001, current_indicative_book_value_usd, current_indicative_unit_price_usd, royalty_pool_percent=0.50, minimum_purchase_usd=20, thai_vat_rate=0.07, gateway_fee_rate=0.05, valuation_multiple=3.0, max_daily_value_change=0.10, status enum('active','paused','closed'), timestamps).
- `royalty_purchase_quotes` (id, user_id, book_id, requested_usd, unit_price, units, ownership_percentage, subtotal_usd, vat_usd, gateway_fee_usd, total_payment_usd, estimated_royalty_per_sale, estimated_break_even_sales_subtotal, estimated_break_even_sales_total, status enum('draft','quoted','awaiting_payment','reserved','simulated_completed','cancelled','expired'), expires_at, created_at).
- `royalty_holdings` (id, user_id, book_id UNIQUE-pair, units_owned, ownership_percentage, average_unit_cost, subtotal_invested_usd, total_vat_usd, total_gateway_fee_usd, total_paid_usd, lifetime_royalty_earned=0, pending_royalty=0, timestamps).
- `book_sales_ledger` (id, book_id, order_id, sale_price_usd, vat_usd, gateway_fee_usd, refund_usd=0, chargeback_usd=0, net_revenue_usd, royalty_pool_usd, sale_status enum('recorded','refunded','charged_back'), sold_at, created_at) — IMMUTABLE (no UPDATE policy; admin-only DELETE).
- `royalty_earnings_ledger` (id, user_id, book_id, holding_id, sale_ledger_id, units_owned_at_sale, ownership_percentage_at_sale, distributable_royalty_pool_usd, royalty_earned_usd, status enum('recorded','paid','reversed'), created_at) — IMMUTABLE.
- `book_valuation_snapshots` (id, book_id, initial_value, trailing_7d/30d/90d_net_sales, valuation_multiple, quality/growth/refund adjustments, indicative_book_value, indicative_unit_value, calculation_json, snapshot_date UNIQUE per (book_id,snapshot_date), created_at).

All numeric money columns use `numeric(18,4)`; unit prices use `numeric(18,8)`.

RLS: user reads own holdings/quotes/earnings; markets/valuations/sales_ledger public-readable; only service_role writes ledgers; admin role writes market settings.

## Server-side calculation

New file `supabase/functions/_shared/royalty-math.ts` — pure functions (server + client can import a subset; ONLY server results are trusted):
- `computeQuote({ market, requested_usd | requested_units }) → { units, subtotal, vat, gateway_fee, total_payment, ownership_pct }`
- `computeOneSaleEconomics({ market, ownership_pct })`
- `computeBreakEven({ subtotal, total_payment, royalty_per_sale })`
- `computeIndicativeValuation({ trailing_sales, multiple, adjustments })`

All arithmetic uses string-based decimals (helpers `d.add/sub/mul/div/round`) — never JS float on money.

## Edge functions

New (buy-only path):
- `royalty-quote` — POST { book_id, amount_usd? , units? } → validates min $20, computes fresh quote from DB (never trusts client), writes `royalty_purchase_quotes` row (status `quoted`, 15-min expiry), returns full breakdown.
- `royalty-reserve` — POST { quote_id } → flips status to `reserved`. NO wallet debit, NO ownership row created. Returns "Payment activation coming soon."
- `royalty-admin-simulate-complete` — admin-only. Given `quote_id`, creates/updates `royalty_holdings`, decrements `book_royalty_markets.units_available`, writes an audit row.
- `royalty-record-book-sale` — hook called from purchase/download path; writes `book_sales_ledger` and fans out `royalty_earnings_ledger` rows for every holder pro-rata.
- `royalty-valuation-recompute` — daily cron; writes one `book_valuation_snapshots` per active book, clamped by `max_daily_value_change`, then updates `book_royalty_markets.current_indicative_*`.

Migrated (renamed for clarity in this phase, old kept as alias):
- `auto-list-ebook` — now also inserts a `book_royalty_markets` row on publish.

## Frontend

Routes:
- `/royalty` — public catalog (`src/pages/Royalty.tsx`), summary cards + book grid.
- `/royalty/book/:bookId` — purchase page (`src/pages/RoyaltyBook.tsx`) with LEFT (book meta) + RIGHT (calculator, one-sale earning section, break-even, Reserve button).
- `/my-royalties` — user ownership (`src/pages/MyRoyalties.tsx`).
- `/admin/royalty-settings` — admin controls (`src/pages/admin/RoyaltySettings.tsx`).

Components (new, under `src/components/royalty/`):
- `RoyaltyBookCard`, `PurchaseCalculator` (USD⇄units two-way sync, debounced server quote), `OneSaleEconomics`, `BreakEvenBox`, `RoyaltyDisclaimers`, `ReserveButton` (shows "Payment activation coming soon" toast on success).

Removed from routes:
- `/exchange`, `/exchange/book/:bookId`, `/exchange/portfolio`, `/exchange/wallet` — redirect to `/royalty` equivalents (301 in `App.tsx`).
- `Header` "Exchange" link renamed to "Royalty Ownership" → `/royalty`.

Copy: all UI strings use approved vocabulary (Royalty Units, Lifetime Revenue Share, etc.). Disclaimer component rendered on every calculator, book card footer, and my-royalties page. Never use "stock/securities/guaranteed/return/profit".

## Skill row

Update `pipeline_skills.rights_exchange_model` → rename `skill_key` to `royalty_ownership_model` v3, content_md rewritten to match this spec (all constants, formulas, disclaimers, phase limits). Old key deleted to avoid drift.

## Acceptance tests

Encoded as one Deno test file `supabase/functions/tests/royalty-math.test.ts`:
1. Base valuation → $0.001 unit
2. $20 → 20,000 units / 2% / VAT $1.40 / gateway $1.07 / total $22.47
3. $19.99 rejected with min-purchase error
4. one-sale royalty computed dynamically
5. break-even both variants
6. no sell endpoint / order-book route exists (grep-based check)
7. reserve creates quote only, no holding, no wallet debit

## Verification

After deploy, drive Playwright from the sandbox against localhost:
- Screenshot `/royalty` grid
- Screenshot `/royalty/book/:bookId` with $20 example populated (assert values match test #2)
- Screenshot Reserve click → toast + no ownership row (query DB after)
- Screenshot `/my-royalties` empty state and post-simulated-completion state (admin action)

## Out of scope (this phase)

Real payment gateway, real wallet top-up, KYC, resale, user-to-user transfer, order book. All Sell UI removed.

## Ordering (batch remains priority)

Cover-fix work is now stable. This module builds while the 10-book batch continues untouched — no shared edge functions modified except `auto-list-ebook` (single additive INSERT into `book_royalty_markets`, wrapped in try/catch so a batch book publish never fails on royalty-market row creation).
