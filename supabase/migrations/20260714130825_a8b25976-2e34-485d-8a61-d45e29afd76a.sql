
CREATE TABLE public.kids_batch_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_live_books int NOT NULL,
  produced_live int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','paused')),
  last_used_theme_id uuid,
  last_used_lane text,
  counted_ebook_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kids_batch_orders TO authenticated;
GRANT ALL ON public.kids_batch_orders TO service_role;
ALTER TABLE public.kids_batch_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage batch orders" ON public.kids_batch_orders
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER kids_batch_orders_touch BEFORE UPDATE ON public.kids_batch_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX kids_batch_orders_status_idx ON public.kids_batch_orders(status);
