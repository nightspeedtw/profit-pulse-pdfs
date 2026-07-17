
CREATE TABLE IF NOT EXISTS public.canva_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_type text NOT NULL DEFAULT 'Bearer',
  scope text,
  expires_at timestamptz NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.canva_oauth_tokens TO service_role;
ALTER TABLE public.canva_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS; anon/authenticated get zero access.

CREATE TABLE IF NOT EXISTS public.canva_oauth_states (
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.canva_oauth_states TO service_role;
ALTER TABLE public.canva_oauth_states ENABLE ROW LEVEL SECURITY;
