
REVOKE EXECUTE ON FUNCTION public.try_acquire_lock(text, uuid, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_lock(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_lock(text, uuid, uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_lock(text, uuid) TO service_role;
