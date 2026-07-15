
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_settings TO anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read platform settings" ON public.platform_settings;
CREATE POLICY "public read platform settings" ON public.platform_settings FOR SELECT USING (true);

INSERT INTO public.platform_settings(key, value_json) VALUES
  ('royalty_fee_pct', '0.03'::jsonb),
  ('royalty_tax_pct', '0'::jsonb),
  ('creator_pool_pct', '0.50'::jsonb),
  ('demo_topup_usd', '100'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  usd_balance NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (usd_balance >= 0),
  is_demo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own wallet" ON public.wallets;
CREATE POLICY "own wallet" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('topup_placeholder','trade_buy','trade_sell','royalty_credit','demo_grant','sell_escrow_return')),
  amount_usd NUMERIC(18,4) NOT NULL,
  balance_after NUMERIC(18,4),
  ref_id UUID,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own wallet tx" ON public.wallet_transactions;
CREATE POLICY "own wallet tx" ON public.wallet_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_ts ON public.wallet_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.rights_offerings (
  book_id UUID PRIMARY KEY,
  book_type TEXT NOT NULL CHECK (book_type IN ('kids','adult')),
  title TEXT NOT NULL,
  cover_url TEXT,
  total_shares BIGINT NOT NULL DEFAULT 1000000,
  treasury_shares BIGINT NOT NULL DEFAULT 1000000 CHECK (treasury_shares >= 0),
  ref_price_per_share NUMERIC(18,8) NOT NULL DEFAULT 0.001,
  last_trade_price NUMERIC(18,8),
  last_trade_at TIMESTAMPTZ,
  volume_24h_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  trailing_90d_net_rev NUMERIC(18,4) NOT NULL DEFAULT 0,
  listed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rights_offerings TO anon, authenticated;
GRANT ALL ON public.rights_offerings TO service_role;
ALTER TABLE public.rights_offerings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read offerings" ON public.rights_offerings;
CREATE POLICY "public read offerings" ON public.rights_offerings FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.rights_holdings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.rights_offerings(book_id) ON DELETE CASCADE,
  shares BIGINT NOT NULL DEFAULT 0 CHECK (shares >= 0),
  avg_cost_per_share NUMERIC(18,8) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);
GRANT SELECT ON public.rights_holdings TO authenticated;
GRANT ALL ON public.rights_holdings TO service_role;
ALTER TABLE public.rights_holdings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own holdings" ON public.rights_holdings;
CREATE POLICY "own holdings" ON public.rights_holdings FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.rights_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.rights_offerings(book_id) ON DELETE CASCADE,
  seller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_treasury BOOLEAN NOT NULL DEFAULT false,
  qty_total BIGINT NOT NULL CHECK (qty_total > 0),
  qty_remaining BIGINT NOT NULL CHECK (qty_remaining >= 0),
  price_per_share NUMERIC(18,8) NOT NULL CHECK (price_per_share > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rights_orders TO anon, authenticated;
GRANT ALL ON public.rights_orders TO service_role;
ALTER TABLE public.rights_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read orders" ON public.rights_orders;
CREATE POLICY "public read orders" ON public.rights_orders FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_rights_orders_book_open ON public.rights_orders(book_id, price_per_share, created_at) WHERE status='open';

CREATE TABLE IF NOT EXISTS public.rights_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.rights_offerings(book_id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_is_treasury BOOLEAN NOT NULL DEFAULT false,
  order_id UUID REFERENCES public.rights_orders(id),
  qty BIGINT NOT NULL CHECK (qty > 0),
  price_per_share NUMERIC(18,8) NOT NULL CHECK (price_per_share > 0),
  gross_usd NUMERIC(18,4) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rights_trades TO anon, authenticated;
GRANT ALL ON public.rights_trades TO service_role;
ALTER TABLE public.rights_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read trades" ON public.rights_trades;
CREATE POLICY "public read trades" ON public.rights_trades FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_rights_trades_book_ts ON public.rights_trades(book_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_trades_buyer ON public.rights_trades(buyer_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_trades_seller ON public.rights_trades(seller_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS public.rights_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.rights_offerings(book_id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref_price NUMERIC(18,8) NOT NULL,
  last_trade_price NUMERIC(18,8),
  volume_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'daily'
);
GRANT SELECT ON public.rights_price_history TO anon, authenticated;
GRANT ALL ON public.rights_price_history TO service_role;
ALTER TABLE public.rights_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read price history" ON public.rights_price_history;
CREATE POLICY "public read price history" ON public.rights_price_history FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_rights_price_history_book_ts ON public.rights_price_history(book_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS public.royalty_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.rights_offerings(book_id) ON DELETE CASCADE,
  sale_ref TEXT NOT NULL,
  holder_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  holder_is_treasury BOOLEAN NOT NULL DEFAULT false,
  shares_at_snapshot BIGINT NOT NULL,
  amount_usd NUMERIC(18,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.royalty_distributions TO authenticated;
GRANT ALL ON public.royalty_distributions TO service_role;
ALTER TABLE public.royalty_distributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own distributions" ON public.royalty_distributions;
CREATE POLICY "own distributions" ON public.royalty_distributions FOR SELECT TO authenticated USING (holder_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_royalty_dist_holder ON public.royalty_distributions(holder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_royalty_dist_book ON public.royalty_distributions(book_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_wallets_updated ON public.wallets;
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_rights_offerings_updated ON public.rights_offerings;
CREATE TRIGGER trg_rights_offerings_updated BEFORE UPDATE ON public.rights_offerings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_rights_orders_updated ON public.rights_orders;
CREATE TRIGGER trg_rights_orders_updated BEFORE UPDATE ON public.rights_orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_rights_holdings_updated ON public.rights_holdings;
CREATE TRIGGER trg_rights_holdings_updated BEFORE UPDATE ON public.rights_holdings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.exchange_execute_buy(
  p_buyer UUID,
  p_book UUID,
  p_qty BIGINT,
  p_max_cost NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining BIGINT := p_qty;
  v_spent NUMERIC(18,4) := 0;
  v_balance NUMERIC(18,4);
  v_order RECORD;
  v_fill BIGINT;
  v_cost NUMERIC(18,4);
  v_trades JSONB := '[]'::jsonb;
  v_last_price NUMERIC(18,8);
  v_total_qty BIGINT := 0;
  v_total_cost NUMERIC(18,4) := 0;
  v_hold_shares BIGINT;
  v_hold_avg NUMERIC(18,8);
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'qty must be > 0'; END IF;

  SELECT usd_balance INTO v_balance FROM public.wallets WHERE user_id = p_buyer FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'no_wallet'; END IF;

  FOR v_order IN
    SELECT id, seller_id, is_treasury, qty_remaining, price_per_share
    FROM public.rights_orders
    WHERE book_id = p_book AND status = 'open' AND qty_remaining > 0
    ORDER BY price_per_share ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining = 0;
    v_fill := LEAST(v_remaining, v_order.qty_remaining);
    v_cost := ROUND(v_fill * v_order.price_per_share, 4);

    IF v_spent + v_cost > v_balance THEN
      v_fill := FLOOR((v_balance - v_spent) / v_order.price_per_share);
      IF v_fill <= 0 THEN EXIT; END IF;
      v_cost := ROUND(v_fill * v_order.price_per_share, 4);
    END IF;

    UPDATE public.rights_orders
      SET qty_remaining = qty_remaining - v_fill,
          status = CASE WHEN qty_remaining - v_fill = 0 THEN 'filled' ELSE 'open' END
      WHERE id = v_order.id;

    IF v_order.is_treasury THEN
      UPDATE public.rights_offerings
        SET treasury_shares = treasury_shares - v_fill
        WHERE book_id = p_book;
    ELSIF v_order.seller_id IS NOT NULL THEN
      UPDATE public.wallets
        SET usd_balance = usd_balance + v_cost
        WHERE user_id = v_order.seller_id;
      INSERT INTO public.wallet_transactions(user_id, type, amount_usd, ref_id, meta)
        VALUES (v_order.seller_id, 'trade_sell', v_cost, v_order.id,
          jsonb_build_object('book_id', p_book, 'qty', v_fill, 'price', v_order.price_per_share));
    END IF;

    INSERT INTO public.rights_trades(book_id, buyer_id, seller_id, seller_is_treasury, order_id, qty, price_per_share, gross_usd)
      VALUES (p_book, p_buyer, v_order.seller_id, v_order.is_treasury, v_order.id, v_fill, v_order.price_per_share, v_cost);

    v_trades := v_trades || jsonb_build_object('order_id', v_order.id, 'qty', v_fill, 'price', v_order.price_per_share, 'cost', v_cost);
    v_last_price := v_order.price_per_share;
    v_total_qty := v_total_qty + v_fill;
    v_total_cost := v_total_cost + v_cost;
    v_spent := v_spent + v_cost;
    v_remaining := v_remaining - v_fill;
  END LOOP;

  IF v_total_qty = 0 THEN
    RAISE EXCEPTION 'no_fills_available';
  END IF;

  UPDATE public.wallets
    SET usd_balance = usd_balance - v_total_cost
    WHERE user_id = p_buyer
    RETURNING usd_balance INTO v_balance;

  INSERT INTO public.wallet_transactions(user_id, type, amount_usd, balance_after, ref_id, meta)
    VALUES (p_buyer, 'trade_buy', -v_total_cost, v_balance, p_book,
      jsonb_build_object('book_id', p_book, 'qty', v_total_qty, 'trades', v_trades));

  SELECT shares, avg_cost_per_share INTO v_hold_shares, v_hold_avg
    FROM public.rights_holdings WHERE user_id = p_buyer AND book_id = p_book FOR UPDATE;
  IF v_hold_shares IS NULL THEN
    INSERT INTO public.rights_holdings(user_id, book_id, shares, avg_cost_per_share)
      VALUES (p_buyer, p_book, v_total_qty, v_total_cost / v_total_qty);
  ELSE
    UPDATE public.rights_holdings
      SET shares = shares + v_total_qty,
          avg_cost_per_share = ((shares * avg_cost_per_share) + v_total_cost) / (shares + v_total_qty)
      WHERE user_id = p_buyer AND book_id = p_book;
  END IF;

  UPDATE public.rights_offerings
    SET last_trade_price = v_last_price,
        last_trade_at = now(),
        volume_24h_usd = volume_24h_usd + v_total_cost
    WHERE book_id = p_book;

  INSERT INTO public.rights_price_history(book_id, ref_price, last_trade_price, volume_usd, source)
    SELECT p_book, ref_price_per_share, v_last_price, v_total_cost, 'trade'
    FROM public.rights_offerings WHERE book_id = p_book;

  RETURN jsonb_build_object(
    'ok', true, 'qty_filled', v_total_qty, 'total_cost', v_total_cost,
    'avg_price', v_total_cost / v_total_qty, 'trades', v_trades,
    'balance_after', v_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exchange_execute_buy(UUID,UUID,BIGINT,NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_execute_buy(UUID,UUID,BIGINT,NUMERIC) TO service_role;

INSERT INTO public.pipeline_skills(skill_key, source, content_md, metadata)
SELECT 'rights_exchange_model', 'learned',
E'# Rights Exchange Economic Model\n\n- Shares per book: 1,000,000\n- Base valuation: $1,000 → base share price $0.001\n- Reference price: max(0.001, (1000 + trailing_90d_net_rev*4)/1_000_000) * momentum\n- Momentum: clamp(1 + 0.10 * sales_rank_percentile, 0.8, 1.5)\n- Royalty split per sale: fee 3% + tax 0% deducted; 50% to creator pool; remainder pro-rata to shareholders (treasury earns on unsold shares).\n- Reference price seeds treasury ask + chart. Actual trades execute at order-book prices.',
  jsonb_build_object(
    'shares_per_book', 1000000, 'base_share_price', 0.001,
    'fee_pct', 0.03, 'tax_pct', 0, 'creator_pool_pct', 0.5
  )
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_skills WHERE skill_key = 'rights_exchange_model');
