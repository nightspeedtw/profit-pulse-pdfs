ALTER TABLE public.cost_log ADD COLUMN IF NOT EXISTS provider text;
CREATE INDEX IF NOT EXISTS idx_cost_log_provider_created ON public.cost_log (provider, created_at DESC);