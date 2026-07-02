
CREATE TABLE IF NOT EXISTS public.production_locks (
  name text PRIMARY KEY,
  holder_ebook_id uuid,
  holder_run_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT ALL ON public.production_locks TO service_role;

ALTER TABLE public.production_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages locks"
  ON public.production_locks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.try_acquire_lock(
  p_name text,
  p_holder uuid,
  p_run_id uuid DEFAULT NULL,
  p_ttl_sec int DEFAULT 3600
)
RETURNS TABLE(acquired boolean, holder uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.production_locks (name, holder_ebook_id, holder_run_id, acquired_at, expires_at)
    VALUES (p_name, p_holder, p_run_id, now(), now() + make_interval(secs => p_ttl_sec))
  ON CONFLICT (name) DO UPDATE
    SET holder_ebook_id = EXCLUDED.holder_ebook_id,
        holder_run_id   = EXCLUDED.holder_run_id,
        acquired_at     = EXCLUDED.acquired_at,
        expires_at      = EXCLUDED.expires_at
    WHERE production_locks.expires_at < now()
       OR production_locks.holder_ebook_id IS NOT DISTINCT FROM EXCLUDED.holder_ebook_id;
  RETURN QUERY
    SELECT (pl.holder_ebook_id IS NOT DISTINCT FROM p_holder) AS acquired,
           pl.holder_ebook_id AS holder,
           pl.expires_at
    FROM public.production_locks pl
    WHERE pl.name = p_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_lock(p_name text, p_holder uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted int;
BEGIN
  DELETE FROM public.production_locks
   WHERE name = p_name
     AND (holder_ebook_id IS NOT DISTINCT FROM p_holder);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted > 0;
END;
$$;

ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS browserless_retry_count int NOT NULL DEFAULT 0;

ALTER TABLE public.generation_settings
  ADD COLUMN IF NOT EXISTS sequential_safe_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS heavy_production_concurrency int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pdf_render_concurrency int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS shopify_upload_concurrency int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS browserless_concurrency int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS idea_generation_concurrency int NOT NULL DEFAULT 5;
