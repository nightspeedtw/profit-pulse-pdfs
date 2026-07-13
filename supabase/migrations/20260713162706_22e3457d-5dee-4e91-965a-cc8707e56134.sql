
-- 1) Lock down SECURITY DEFINER helpers: revoke from PUBLIC/anon, keep for authenticated + service_role (needed by RLS policies)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.try_acquire_lock(text, uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.try_acquire_lock(text, uuid, uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_lock(text, uuid, uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_lock(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_lock(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_lock(text, uuid) TO service_role;

-- 2) autopilot_pipeline_runs / steps: explicit deny for anon (belt + suspenders for realtime)
DROP POLICY IF EXISTS "Deny anon autopilot_pipeline_runs" ON public.autopilot_pipeline_runs;
CREATE POLICY "Deny anon autopilot_pipeline_runs"
  ON public.autopilot_pipeline_runs
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny anon autopilot_pipeline_steps" ON public.autopilot_pipeline_steps;
CREATE POLICY "Deny anon autopilot_pipeline_steps"
  ON public.autopilot_pipeline_steps
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- 3) download_grants: block all client writes; only service_role may mutate
DROP POLICY IF EXISTS "Block client inserts on download_grants" ON public.download_grants;
CREATE POLICY "Block client inserts on download_grants"
  ON public.download_grants
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Block client updates on download_grants" ON public.download_grants;
CREATE POLICY "Block client updates on download_grants"
  ON public.download_grants
  AS RESTRICTIVE
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Block client deletes on download_grants" ON public.download_grants;
CREATE POLICY "Block client deletes on download_grants"
  ON public.download_grants
  AS RESTRICTIVE
  FOR DELETE
  TO anon, authenticated
  USING (false);

-- 4) orders: block all client writes; only service_role may mutate
DROP POLICY IF EXISTS "Block client inserts on orders" ON public.orders;
CREATE POLICY "Block client inserts on orders"
  ON public.orders
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Block client updates on orders" ON public.orders;
CREATE POLICY "Block client updates on orders"
  ON public.orders
  AS RESTRICTIVE
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Block client deletes on orders" ON public.orders;
CREATE POLICY "Block client deletes on orders"
  ON public.orders
  AS RESTRICTIVE
  FOR DELETE
  TO anon, authenticated
  USING (false);
