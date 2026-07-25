-- ============ book_licenses ============
CREATE TABLE public.book_licenses (
  book_id uuid PRIMARY KEY REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  personal_price_cents int NOT NULL DEFAULT 1499 CHECK (personal_price_cents >= 0),
  commercial_price_cents int NOT NULL DEFAULT 3900 CHECK (commercial_price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.book_licenses TO anon, authenticated;
GRANT ALL ON public.book_licenses TO service_role;
ALTER TABLE public.book_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "book_licenses public read" ON public.book_licenses FOR SELECT USING (true);
CREATE TRIGGER book_licenses_set_updated_at BEFORE UPDATE ON public.book_licenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed for existing live coloring books
INSERT INTO public.book_licenses (book_id)
SELECT id FROM public.ebooks_kids WHERE listing_status = 'live'
ON CONFLICT (book_id) DO NOTHING;

-- ============ commercial_subscriptions ============
CREATE TABLE public.commercial_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paddle_subscription_id text NOT NULL UNIQUE,
  paddle_customer_id text NOT NULL,
  plan_code text NOT NULL CHECK (plan_code IN ('commercial_25','commercial_50')),
  status text NOT NULL DEFAULT 'active',
  credits_per_period int NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commercial_subs_user ON public.commercial_subscriptions(user_id);
GRANT SELECT ON public.commercial_subscriptions TO authenticated;
GRANT ALL ON public.commercial_subscriptions TO service_role;
ALTER TABLE public.commercial_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial_subs owner read" ON public.commercial_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "commercial_subs admin read" ON public.commercial_subscriptions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER commercial_subs_set_updated_at BEFORE UPDATE ON public.commercial_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ commercial_credit_ledger ============
CREATE TABLE public.commercial_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.commercial_subscriptions(id) ON DELETE SET NULL,
  delta int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('period_grant','unlock','rollover_expire','admin_adjust','refund')),
  book_id uuid REFERENCES public.ebooks_kids(id) ON DELETE SET NULL,
  expires_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_ledger_user ON public.commercial_credit_ledger(user_id);
CREATE INDEX idx_credit_ledger_expires ON public.commercial_credit_ledger(expires_at) WHERE expires_at IS NOT NULL;
GRANT SELECT ON public.commercial_credit_ledger TO authenticated;
GRANT ALL ON public.commercial_credit_ledger TO service_role;
ALTER TABLE public.commercial_credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_ledger owner read" ON public.commercial_credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "credit_ledger admin read" ON public.commercial_credit_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ book_licenses_owned ============
CREATE TABLE public.book_licenses_owned (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  license_type text NOT NULL CHECK (license_type IN ('personal','commercial')),
  purchase_source text NOT NULL CHECK (purchase_source IN ('one_off','subscription_unlock','admin_grant')),
  order_id uuid,
  subscription_id uuid REFERENCES public.commercial_subscriptions(id) ON DELETE SET NULL,
  commercial_rights_active boolean NOT NULL DEFAULT false,
  commercial_rights_last_active_at timestamptz,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, book_id)
);
CREATE INDEX idx_owned_user ON public.book_licenses_owned(user_id);
CREATE INDEX idx_owned_book ON public.book_licenses_owned(book_id);
GRANT SELECT ON public.book_licenses_owned TO authenticated;
GRANT ALL ON public.book_licenses_owned TO service_role;
ALTER TABLE public.book_licenses_owned ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owned owner read" ON public.book_licenses_owned FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owned admin read" ON public.book_licenses_owned FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER owned_set_updated_at BEFORE UPDATE ON public.book_licenses_owned FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ download_tokens ============
CREATE TABLE public.download_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  license_type text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_count int NOT NULL DEFAULT 0,
  max_uses int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dl_tokens_user ON public.download_tokens(user_id);
CREATE INDEX idx_dl_tokens_expires ON public.download_tokens(expires_at);
GRANT SELECT ON public.download_tokens TO authenticated;
GRANT ALL ON public.download_tokens TO service_role;
ALTER TABLE public.download_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dl_tokens owner read" ON public.download_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.has_active_commercial_subscription(user_uuid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.commercial_subscriptions
    WHERE user_id = user_uuid
      AND status IN ('active','trialing','past_due')
      AND (current_period_end IS NULL OR current_period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.commercial_credit_balance(user_uuid uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(delta),0)::int
    FROM public.commercial_credit_ledger
   WHERE user_id = user_uuid
     AND (expires_at IS NULL OR expires_at > now());
$$;