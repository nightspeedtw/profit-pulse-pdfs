-- Revoke EXECUTE from public/anon/authenticated on SECURITY DEFINER functions
-- that should only be called by triggers or backend service code.

REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_lock(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_acquire_lock(text, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

-- has_role is used inside RLS policies via `public.has_role(auth.uid(), 'admin')`.
-- RLS evaluates policies as the calling role, so authenticated must retain EXECUTE.
-- Revoke from anon (never needed) and public default.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;