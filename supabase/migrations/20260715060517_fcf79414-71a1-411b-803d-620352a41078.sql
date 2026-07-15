
REVOKE ALL ON FUNCTION public.exchange_buy_amount(uuid, uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_buy_amount(uuid, uuid, numeric, numeric, numeric) TO service_role;
