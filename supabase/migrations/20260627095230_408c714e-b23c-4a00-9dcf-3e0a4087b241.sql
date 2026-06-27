ALTER TABLE public.ebook_ideas
  ADD COLUMN IF NOT EXISTS buyer_identity text,
  ADD COLUMN IF NOT EXISTS cost_of_doing_nothing text,
  ADD COLUMN IF NOT EXISTS value_proposition text,
  ADD COLUMN IF NOT EXISTS hard_sell_opening text,
  ADD COLUMN IF NOT EXISTS objection_handling jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shopify_meta jsonb DEFAULT '{}'::jsonb;