
-- ============ subscriptions ============
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  paddle_subscription_id text NOT NULL UNIQUE,
  paddle_customer_id text NOT NULL,
  product_id text NOT NULL,
  price_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  environment text NOT NULL DEFAULT 'sandbox',
  credits_per_period integer NOT NULL DEFAULT 0,
  credits_reset_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_id ON public.subscriptions(paddle_subscription_id);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages subscriptions" ON public.subscriptions;
CREATE POLICY "Service role manages subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ checkout_tokens ============
CREATE TABLE IF NOT EXISTS public.checkout_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items jsonb NOT NULL,
  total_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  environment text NOT NULL DEFAULT 'sandbox',
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_transaction_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_tokens_user ON public.checkout_tokens(user_id);

GRANT SELECT ON public.checkout_tokens TO authenticated;
GRANT ALL ON public.checkout_tokens TO service_role;

ALTER TABLE public.checkout_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own checkout tokens" ON public.checkout_tokens;
CREATE POLICY "Users view own checkout tokens"
  ON public.checkout_tokens FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages checkout tokens" ON public.checkout_tokens;
CREATE POLICY "Service role manages checkout tokens"
  ON public.checkout_tokens FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============ download_grants.source ============
ALTER TABLE public.download_grants
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'purchase';

-- ============ has_active_subscription ============
CREATE OR REPLACE FUNCTION public.has_active_subscription(
  user_uuid uuid,
  check_env text DEFAULT 'live'
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
      AND environment = check_env
      AND (
        (status IN ('active','trialing','past_due')
          AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  );
$$;
