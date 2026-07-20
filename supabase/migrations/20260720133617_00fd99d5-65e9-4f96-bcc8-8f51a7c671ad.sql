
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_discount_pct_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_discount_pct_check CHECK (discount_pct >= 5 AND discount_pct <= 95);

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_min_price_floor_cents_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_min_price_floor_cents_check CHECK (min_price_floor_cents >= 200);
