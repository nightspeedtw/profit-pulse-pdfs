## Royalty Rights Exchange — Phase 1 Build Plan

Stock-market-style trading of book royalty shares with a **simulated USD wallet** (no real payments yet). All two currently live books auto-list; every future publish auto-lists.

---

### 1. Economic Model (single source of truth)

Constants file `src/lib/exchange/model.ts` + edge mirror `supabase/functions/_shared/exchange-model.ts`, plus a `pipeline_skills` row `rights_exchange_model` documenting the formula.

- **1,000,000 shares per book**, base valuation **$1,000** → base share price **$0.001**.
- **Reference price formula** (recomputed daily + on each trade):
  `ref = max(0.001, (1000 + trailing_90d_net_sales_rev × 4) / 1_000_000) × momentum`
  `momentum = clamp(1 + 0.10 × sales_rank_percentile, 0.8, 1.5)` (0.8 floor for zero-sales)
- **Royalty split on each recorded book sale**:
  `net = sale_price × (1 − fee_pct − tax_pct)` (defaults: fee 3%, tax 0% — stored in `platform_settings`)
  → 50% creator pool (if Create&Earn creator exists) → remainder to royalty pool → credited pro-rata to shareholders by snapshot at sale time. Treasury earns on unsold shares.
- Every distribution logged in `royalty_distributions`.

---

### 2. Data Model (migration)

Tables (all with GRANTs + RLS):

- `wallets` (user_id PK, usd_balance NUMERIC ≥ 0, is_demo bool)
- `wallet_transactions` (id, user_id, type: `topup_placeholder|trade_buy|trade_sell|royalty_credit|demo_grant`, amount_usd, ref_id, meta)
- `rights_offerings` (book_id PK → ebooks_kids.id (nullable) / ebooks.id, total_shares=1M, treasury_shares, ref_price_per_share, market_cap, last_trade_price, updated_at)
- `rights_holdings` (user_id, book_id, shares ≥ 0, PK(user_id, book_id)) — treasury represented by user_id = NULL sentinel row **or** a dedicated `is_treasury` boolean; using dedicated `platform_treasury` view over `rights_offerings.treasury_shares` to avoid NULL FK
- `rights_orders` (id, seller_id (nullable=treasury), book_id, qty_remaining, price_per_share, status: `open|filled|cancelled`, created_at)
- `rights_trades` (id, book_id, buyer_id, seller_id (nullable), qty, price_per_share, gross_usd, executed_at)
- `rights_price_history` (book_id, day/ts, ref_price, last_trade_price, volume) — daily snapshots + intraday rollup
- `royalty_distributions` (id, book_id, sale_ref, holder_id, shares_at_snapshot, amount_usd, created_at)
- `platform_settings` (key PK, value_json) seeded with `royalty_fee_pct=0.03`, `royalty_tax_pct=0`, `creator_pool_pct=0.50`

**Constraints:** `wallets.usd_balance >= 0`, `rights_holdings.shares >= 0`, `rights_orders.qty_remaining >= 0`, `rights_offerings.treasury_shares >= 0`.

**RLS:**
- wallets/wallet_transactions/rights_holdings/royalty_distributions → owner (`auth.uid()`) SELECT only; writes via service role.
- rights_offerings / rights_orders / rights_trades / rights_price_history → public SELECT.
- Cancel own order via edge function (service role), not direct DELETE.

---

### 3. Edge Functions

- `exchange-list-book` — idempotent auto-list: create `rights_offerings` (1M treasury shares) + seed ask at ref price + first price-history row.
- `exchange-buy` — transactional matcher: walk asks ascending, partial-fill allowed, atomic wallet/holdings/orders update, insert trades, update `last_trade_price` + price history, reject on insufficient balance.
- `exchange-sell-list` — validate holdings, create sell order, escrow shares (deduct from holdings into order).
- `exchange-cancel-order` — return escrowed shares to holdings.
- `exchange-recompute-refprice` — daily cron + on-trade recompute; writes `rights_price_history` snapshot.
- `exchange-record-book-sale` — hook invoked by existing purchase/download-grant paths; computes distribution, credits wallets, inserts `royalty_distributions` + `wallet_transactions`.
- `exchange-wallet-topup-demo` — grants $100 DEMO once per new user (idempotent).
- `exchange-backfill-live-books` — one-shot: list all `listing_status='live'` books.

Hooks: `kids-publish-if-qc-passed` (kids) and `auto-list-ebook` (adult) → invoke `exchange-list-book` after flipping live.

---

### 4. Frontend (`/exchange`)

Routes added to `src/App.tsx`:
- `/exchange` — Board (public)
- `/exchange/book/:bookId` — Book detail (public browse, auth-gated trade panels)
- `/exchange/portfolio` — auth-required
- `/exchange/wallet` — auth-required

Components:
- `Board`: card+table with cover, title, last price, 24h/7d %, ref price, market cap, star rating, sparkline (recharts). Sort tabs: Movers / Market Cap / Newest.
- `BookDetail`: price chart (recharts area/line), asks ladder, recent trades, BUY panel (qty → live cost preview → execute), SELL panel (qty + limit price → escrow), your position + royalty earnings.
- `Portfolio`: holdings table with current value & P/L, royalty income history, open orders (cancel button).
- `Wallet`: balance, "Top Up" placeholder modal (bilingual copy), transaction history. Demo grant runs on first visit.
- Compliance banner component reused site-wide on all exchange pages:
  > 🇹🇭 นี่คือส่วนแบ่งรายได้ค่าลิขสิทธิ์ ไม่ใช่หุ้นบริษัท · รายได้ไม่การันตี · ระบบช่วงทดลองใช้ยอดเงินจำลอง (DEMO) ยังไม่มีการชำระเงินจริง
  > 🇬🇧 These are royalty revenue shares, not company equity. No income guaranteed. Demo balance only — no real payments yet.

Header nav gets a new "Exchange" link.

Admin: small section on `/admin` (Dashboard) showing exchange totals (books listed, total shares out of treasury, 24h volume, total royalties distributed).

---

### 5. Verification

- Migration + backfill run → confirm both current live books appear on board.
- Playwright script logs in a test user, tops up demo balance (auto-granted), buys 5,000 shares of one book, sells 1,000 back at a limit price, cancels remainder — screenshots of board, detail, buy-preview, portfolio, wallet.
- SQL asserts: wallets never negative, sum(holdings)+treasury = 1,000,000 per book, trades match orders atomically.

---

### 6. Out of scope (Phase 1)

- Real payment gateway (Top Up is a placeholder modal only).
- KYC / regulatory registration.
- Order types beyond limit sell + market buy (matched against ask ladder).
- WebSocket live updates — Phase 1 uses polling / React Query refetch.
- Mobile-native app.

---

### Files created / edited (high level)

**New migrations:** 1 file (all tables + RLS + GRANTs + seed platform_settings + `rights_exchange_model` skill row).
**New edge functions:** 8 (listed above).
**New shared:** `supabase/functions/_shared/exchange-model.ts`.
**New frontend:** `src/pages/Exchange.tsx`, `ExchangeBook.tsx`, `ExchangePortfolio.tsx`, `ExchangeWallet.tsx`, `src/components/exchange/*` (Board, OrderBook, PriceChart, BuyPanel, SellPanel, ComplianceBanner, TopUpModal), `src/lib/exchange/{model.ts, api.ts, formatters.ts}`.
**Edited:** `src/App.tsx` (routes), `src/components/Header.tsx` (nav link), `src/pages/admin/Dashboard.tsx` (exchange totals card), `supabase/functions/kids-publish-if-qc-passed/index.ts` (auto-list hook), `supabase/functions/auto-list-ebook/index.ts` (auto-list hook), existing purchase/download-grant path (`supabase/functions/customer-download-pdf/index.ts` or equivalent — will confirm during build) to invoke `exchange-record-book-sale`.
