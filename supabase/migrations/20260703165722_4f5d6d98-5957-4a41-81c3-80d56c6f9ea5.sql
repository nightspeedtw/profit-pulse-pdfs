
-- 1. ebooks storefront listing columns
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS listed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ebooks_listed_at ON public.ebooks(listed_at) WHERE listed_at IS NOT NULL;

-- 2. orders
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_email text NOT NULL,
  stripe_session_id text UNIQUE,
  stripe_payment_intent text,
  amount_total integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending',
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyers view own orders" ON public.orders
  FOR SELECT TO authenticated
  USING (buyer_user_id = auth.uid());

CREATE INDEX idx_orders_buyer_user ON public.orders(buyer_user_id);
CREATE INDEX idx_orders_buyer_email ON public.orders(buyer_email);
CREATE INDEX idx_orders_stripe_session ON public.orders(stripe_session_id);

-- 3. order_items
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ebook_id uuid NOT NULL REFERENCES public.ebooks(id) ON DELETE RESTRICT,
  unit_price integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  title_snapshot text NOT NULL,
  cover_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyers view own order items" ON public.order_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.buyer_user_id = auth.uid()));

CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_ebook ON public.order_items(ebook_id);

-- 4. download_grants
CREATE TABLE public.download_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ebook_id uuid NOT NULL REFERENCES public.ebooks(id) ON DELETE RESTRICT,
  buyer_email text NOT NULL,
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  download_count integer NOT NULL DEFAULT 0,
  max_downloads integer NOT NULL DEFAULT 5,
  last_downloaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.download_grants TO authenticated;
GRANT ALL ON public.download_grants TO service_role;
ALTER TABLE public.download_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyers view own grants" ON public.download_grants
  FOR SELECT TO authenticated
  USING (buyer_user_id = auth.uid());

CREATE INDEX idx_grants_order ON public.download_grants(order_id);
CREATE INDEX idx_grants_token ON public.download_grants(token);
CREATE INDEX idx_grants_email ON public.download_grants(buyer_email);

-- 5. updated_at trigger for orders
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
