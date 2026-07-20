
-- 1. acct_profiles
CREATE TABLE public.acct_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.acct_profiles TO authenticated;
GRANT ALL ON public.acct_profiles TO service_role;
ALTER TABLE public.acct_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acct_profiles owner read" ON public.acct_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "acct_profiles owner upsert" ON public.acct_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "acct_profiles owner update" ON public.acct_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER acct_profiles_updated_at BEFORE UPDATE ON public.acct_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. acct_notifications
CREATE TABLE public.acct_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX acct_notifications_user_idx ON public.acct_notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.acct_notifications TO authenticated;
GRANT ALL ON public.acct_notifications TO service_role;
ALTER TABLE public.acct_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acct_notifications owner read" ON public.acct_notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "acct_notifications owner mark read" ON public.acct_notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. acct_download_events (audit)
CREATE TABLE public.acct_download_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_id UUID,
  product_kind TEXT,
  product_id UUID,
  storage_path TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  outcome TEXT NOT NULL DEFAULT 'issued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX acct_download_events_user_idx ON public.acct_download_events(user_id, created_at DESC);
GRANT SELECT ON public.acct_download_events TO authenticated;
GRANT ALL ON public.acct_download_events TO service_role;
ALTER TABLE public.acct_download_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acct_download_events owner read" ON public.acct_download_events FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4. acct_data_requests (privacy export)
CREATE TABLE public.acct_data_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ,
  download_url TEXT,
  expires_at TIMESTAMPTZ
);
CREATE INDEX acct_data_requests_user_idx ON public.acct_data_requests(user_id, requested_at DESC);
GRANT SELECT, INSERT ON public.acct_data_requests TO authenticated;
GRANT ALL ON public.acct_data_requests TO service_role;
ALTER TABLE public.acct_data_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acct_data_requests owner read" ON public.acct_data_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "acct_data_requests owner insert" ON public.acct_data_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 5. acct_deletion_requests (with cooling-off)
CREATE TABLE public.acct_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX acct_deletion_requests_one_pending
  ON public.acct_deletion_requests(user_id) WHERE status = 'pending';
GRANT SELECT, INSERT, UPDATE ON public.acct_deletion_requests TO authenticated;
GRANT ALL ON public.acct_deletion_requests TO service_role;
ALTER TABLE public.acct_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acct_deletion_requests owner read" ON public.acct_deletion_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "acct_deletion_requests owner insert" ON public.acct_deletion_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "acct_deletion_requests owner cancel" ON public.acct_deletion_requests FOR UPDATE TO authenticated USING (auth.uid() = user_id AND status = 'pending') WITH CHECK (auth.uid() = user_id AND status IN ('pending','cancelled'));
