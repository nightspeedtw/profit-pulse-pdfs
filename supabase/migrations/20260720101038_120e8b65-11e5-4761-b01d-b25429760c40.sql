
-- Kill switch column
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS royalty_live boolean NOT NULL DEFAULT false;

-- Book kind enum (guarded)
DO $$ BEGIN
  CREATE TYPE public.roy_book_kind AS ENUM ('adult','kids','coloring_v2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roy_account_type AS ENUM ('shareholder_accrued','platform_reserve','pool_income','payout_pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roy_direction AS ENUM ('debit','credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roy_source AS ENUM ('order','adjustment','payout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ roy_book_config ============
CREATE TABLE public.roy_book_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  book_kind public.roy_book_kind NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  total_shares bigint NOT NULL DEFAULT 1000 CHECK (total_shares > 0),
  reserve_shares bigint NOT NULL DEFAULT 0 CHECK (reserve_shares >= 0),
  price_per_share_cents integer NOT NULL DEFAULT 100 CHECK (price_per_share_cents > 0),
  royalty_pct_of_net numeric(5,4) NOT NULL DEFAULT 0.20 CHECK (royalty_pct_of_net >= 0 AND royalty_pct_of_net <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, book_kind),
  CHECK (reserve_shares <= total_shares)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roy_book_config TO authenticated;
GRANT ALL ON public.roy_book_config TO service_role;
ALTER TABLE public.roy_book_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roy_book_config admin all" ON public.roy_book_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_roy_book_config_updated
  BEFORE UPDATE ON public.roy_book_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ roy_holdings ============
CREATE TABLE public.roy_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  book_kind public.roy_book_kind NOT NULL,
  shares bigint NOT NULL DEFAULT 0 CHECK (shares >= 0),
  avg_cost_cents integer NOT NULL DEFAULT 0 CHECK (avg_cost_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, book_kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roy_holdings TO authenticated;
GRANT ALL ON public.roy_holdings TO service_role;
ALTER TABLE public.roy_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roy_holdings owner read" ON public.roy_holdings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roy_holdings admin write" ON public.roy_holdings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_roy_holdings_updated
  BEFORE UPDATE ON public.roy_holdings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ roy_ledger (append-only) ============
CREATE TABLE public.roy_ledger (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id uuid NOT NULL,
  account_type public.roy_account_type NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  book_id uuid,
  book_kind public.roy_book_kind,
  direction public.roy_direction NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  source public.roy_source NOT NULL,
  source_ref text NOT NULL,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roy_ledger_txn_idx ON public.roy_ledger(txn_id);
CREATE INDEX roy_ledger_user_book_idx ON public.roy_ledger(user_id, book_id);
CREATE UNIQUE INDEX roy_ledger_source_ref_uniq ON public.roy_ledger(source, source_ref, account_type, user_id, direction);
GRANT SELECT, INSERT ON public.roy_ledger TO authenticated;
GRANT ALL ON public.roy_ledger TO service_role;
ALTER TABLE public.roy_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roy_ledger admin read" ON public.roy_ledger
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "roy_ledger admin insert" ON public.roy_ledger
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Append-only enforcement
CREATE OR REPLACE FUNCTION public.roy_ledger_no_mutate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'roy_ledger is append-only; % not allowed', TG_OP;
END;
$$;
CREATE TRIGGER trg_roy_ledger_no_update
  BEFORE UPDATE ON public.roy_ledger
  FOR EACH ROW EXECUTE FUNCTION public.roy_ledger_no_mutate();
CREATE TRIGGER trg_roy_ledger_no_delete
  BEFORE DELETE ON public.roy_ledger
  FOR EACH ROW EXECUTE FUNCTION public.roy_ledger_no_mutate();

-- ============ roy_accrual_summary ============
CREATE TABLE public.roy_accrual_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  book_kind public.roy_book_kind NOT NULL,
  shares bigint NOT NULL DEFAULT 0,
  accrued_cents bigint NOT NULL DEFAULT 0,
  paid_cents bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, book_kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roy_accrual_summary TO authenticated;
GRANT ALL ON public.roy_accrual_summary TO service_role;
ALTER TABLE public.roy_accrual_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roy_summary owner read" ON public.roy_accrual_summary
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roy_summary admin write" ON public.roy_accrual_summary
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_roy_summary_updated
  BEFORE UPDATE ON public.roy_accrual_summary
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
