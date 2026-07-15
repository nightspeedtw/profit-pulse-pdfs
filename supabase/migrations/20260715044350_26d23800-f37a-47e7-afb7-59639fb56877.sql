
REVOKE EXECUTE ON FUNCTION public.exchange_execute_buy(UUID,UUID,BIGINT,NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_execute_buy(UUID,UUID,BIGINT,NUMERIC) TO service_role;
