CREATE TABLE public.roy_kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'sumsub',
  provider_ref text,
  tier text NOT NULL DEFAULT 'basic',
  status text NOT NULL DEFAULT 'not_started',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roy_kyc_status_chk CHECK (status IN ('not_started','pending','approved','rejected','expired'))
);
CREATE UNIQUE INDEX roy_kyc_one_active_per_user ON public.roy_kyc_submissions(user_id) WHERE status IN ('pending','approved');
CREATE INDEX roy_kyc_status_idx ON public.roy_kyc_submissions(status);

GRANT SELECT, INSERT, UPDATE ON public.roy_kyc_submissions TO authenticated;
GRANT ALL ON public.roy_kyc_submissions TO service_role;
ALTER TABLE public.roy_kyc_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own kyc" ON public.roy_kyc_submissions
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "users insert own kyc" ON public.roy_kyc_submissions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND status IN ('not_started','pending'));
CREATE POLICY "admins update kyc" ON public.roy_kyc_submissions
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER roy_kyc_touch BEFORE UPDATE ON public.roy_kyc_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.roy_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL,
  method text NOT NULL DEFAULT 'pending',
  destination jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'requested',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  paid_at timestamptz,
  admin_notes text,
  is_sandbox boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roy_payout_status_chk CHECK (status IN ('requested','approved','rejected','paid','cancelled')),
  CONSTRAINT roy_payout_amount_chk CHECK (amount_cents > 0)
);
CREATE INDEX roy_payout_user_idx ON public.roy_payout_requests(user_id, created_at DESC);
CREATE INDEX roy_payout_status_idx ON public.roy_payout_requests(status);

GRANT SELECT, INSERT, UPDATE ON public.roy_payout_requests TO authenticated;
GRANT ALL ON public.roy_payout_requests TO service_role;
ALTER TABLE public.roy_payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own payouts" ON public.roy_payout_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "users create own payouts" ON public.roy_payout_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND status = 'requested');
CREATE POLICY "users cancel own pending" ON public.roy_payout_requests
  FOR UPDATE TO authenticated USING (auth.uid() = user_id AND status = 'requested')
  WITH CHECK (auth.uid() = user_id AND status IN ('requested','cancelled'));
CREATE POLICY "admins manage payouts" ON public.roy_payout_requests
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER roy_payout_touch BEFORE UPDATE ON public.roy_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.platform_settings(key, value_json) VALUES
  ('royalty_payouts_live', 'false'::jsonb),
  ('royalty_kyc_required', 'true'::jsonb),
  ('royalty_min_payout_usd', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.roy_available_cents(p_user uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    COALESCE((SELECT SUM(accrued_cents - paid_cents) FROM public.roy_accrual_summary WHERE user_id = p_user), 0)
    - COALESCE((SELECT SUM(amount_cents) FROM public.roy_payout_requests
                WHERE user_id = p_user AND status IN ('requested','approved','paid')), 0),
    0
  )::bigint;
$$;
GRANT EXECUTE ON FUNCTION public.roy_available_cents(uuid) TO authenticated, service_role;