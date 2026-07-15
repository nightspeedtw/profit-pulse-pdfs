
INSERT INTO public.platform_settings(key, value_json) VALUES
  ('buy_min_usd', to_jsonb(20)),
  ('buy_gateway_fee_pct', to_jsonb(0.05)),
  ('buy_tax_pct', to_jsonb(0.07)),
  ('royalty_fee_pct', to_jsonb(0.05)),
  ('royalty_tax_pct', to_jsonb(0.07)),
  ('creator_pool_pct', to_jsonb(0.5))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.exchange_buy_amount(
  p_buyer uuid,
  p_book uuid,
  p_amount_gross numeric,
  p_fee_pct numeric,
  p_tax_pct numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC(18,4);
  v_price NUMERIC(18,8);
  v_treasury BIGINT;
  v_fee NUMERIC(18,4);
  v_tax NUMERIC(18,4);
  v_net NUMERIC(18,4);
  v_shares BIGINT;
  v_cost NUMERIC(18,4);
  v_hold_shares BIGINT;
  v_hold_avg NUMERIC(18,8);
  v_treasury_order RECORD;
BEGIN
  IF p_amount_gross <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT usd_balance INTO v_balance FROM public.wallets WHERE user_id = p_buyer FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'no_wallet'; END IF;
  IF v_balance < p_amount_gross THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  SELECT ref_price_per_share, treasury_shares INTO v_price, v_treasury
    FROM public.rights_offerings WHERE book_id = p_book FOR UPDATE;
  IF v_price IS NULL THEN RAISE EXCEPTION 'book_not_listed'; END IF;

  v_fee := ROUND(p_amount_gross * p_fee_pct, 4);
  v_tax := ROUND(p_amount_gross * p_tax_pct, 4);
  v_net := p_amount_gross - v_fee - v_tax;
  IF v_net <= 0 THEN RAISE EXCEPTION 'net_after_fees_zero'; END IF;

  v_shares := FLOOR(v_net / v_price);
  IF v_shares <= 0 THEN RAISE EXCEPTION 'net_too_small_for_one_share'; END IF;
  IF v_shares > v_treasury THEN v_shares := v_treasury; END IF;
  IF v_shares <= 0 THEN RAISE EXCEPTION 'no_treasury_shares'; END IF;

  v_cost := ROUND(v_shares * v_price, 4);

  UPDATE public.wallets SET usd_balance = usd_balance - p_amount_gross
    WHERE user_id = p_buyer RETURNING usd_balance INTO v_balance;

  INSERT INTO public.wallet_transactions(user_id, type, amount_usd, balance_after, ref_id, meta)
    VALUES (p_buyer, 'trade_buy', -p_amount_gross, v_balance, p_book,
      jsonb_build_object(
        'book_id', p_book, 'gross', p_amount_gross,
        'fee', v_fee, 'tax', v_tax, 'net', v_net,
        'shares', v_shares, 'price', v_price, 'cost', v_cost
      ));

  UPDATE public.rights_offerings
    SET treasury_shares = treasury_shares - v_shares,
        last_trade_price = v_price,
        last_trade_at = now(),
        volume_24h_usd = volume_24h_usd + v_cost
    WHERE book_id = p_book;

  SELECT id, qty_remaining INTO v_treasury_order
    FROM public.rights_orders
    WHERE book_id = p_book AND is_treasury = true AND status = 'open'
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF v_treasury_order.id IS NOT NULL THEN
    UPDATE public.rights_orders
      SET qty_remaining = GREATEST(0, qty_remaining - v_shares),
          status = CASE WHEN qty_remaining - v_shares <= 0 THEN 'filled' ELSE 'open' END
      WHERE id = v_treasury_order.id;
  END IF;

  INSERT INTO public.rights_trades(book_id, buyer_id, seller_id, seller_is_treasury, order_id, qty, price_per_share, gross_usd)
    VALUES (p_book, p_buyer, NULL, true, v_treasury_order.id, v_shares, v_price, v_cost);

  SELECT shares, avg_cost_per_share INTO v_hold_shares, v_hold_avg
    FROM public.rights_holdings WHERE user_id = p_buyer AND book_id = p_book FOR UPDATE;
  IF v_hold_shares IS NULL THEN
    INSERT INTO public.rights_holdings(user_id, book_id, shares, avg_cost_per_share)
      VALUES (p_buyer, p_book, v_shares, p_amount_gross / v_shares);
  ELSE
    UPDATE public.rights_holdings
      SET shares = shares + v_shares,
          avg_cost_per_share = ((shares * avg_cost_per_share) + p_amount_gross) / (shares + v_shares)
      WHERE user_id = p_buyer AND book_id = p_book;
  END IF;

  INSERT INTO public.rights_price_history(book_id, ref_price, last_trade_price, volume_usd, source)
    VALUES (p_book, v_price, v_price, v_cost, 'trade');

  RETURN jsonb_build_object(
    'ok', true, 'shares', v_shares, 'price', v_price,
    'gross', p_amount_gross, 'fee', v_fee, 'tax', v_tax,
    'net', v_net, 'cost', v_cost, 'balance_after', v_balance
  );
END;
$$;

INSERT INTO public.pipeline_skills(skill_key, source, version, content_md, metadata)
VALUES ('rights_exchange_model', 'learned', 2,
'# Rights Exchange Model — Phase 1 (Buy-Only)

- Shares per book: 1,000,000
- Base valuation: $1,000 → base share price $0.001
- Reference price rises with sales (existing formula preserved)
- Minimum purchase: $20 per order
- Buy fees: gateway 5% + tax 7% (configurable)
- Shares bought = floor((amount - fee - tax) / ref_price)
- Royalties per book sale: sale_price * (1 - fee - tax) distributed pro-rata across 1M shares (treasury earns on unsold)
- No sell-back / order-book resale in phase 1 (sell tables retained for later)',
  jsonb_build_object(
    'shares_per_book', 1000000,
    'base_share_price', 0.001,
    'min_purchase_usd', 20,
    'buy_gateway_fee_pct', 0.05,
    'buy_tax_pct_default', 0.07,
    'phase', 1,
    'mode', 'buy_only_from_treasury'
  ))
ON CONFLICT (skill_key, version) DO UPDATE SET
  content_md = EXCLUDED.content_md,
  metadata = EXCLUDED.metadata,
  updated_at = now();
