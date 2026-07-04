
ALTER TABLE public.ebooks
  ADD COLUMN IF NOT EXISTS short_hook text,
  ADD COLUMN IF NOT EXISTS shopping_card_description text,
  ADD COLUMN IF NOT EXISTS long_description text,
  ADD COLUMN IF NOT EXISTS key_benefits jsonb,
  ADD COLUMN IF NOT EXISTS who_it_is_for text,
  ADD COLUMN IF NOT EXISTS what_you_get jsonb,
  ADD COLUMN IF NOT EXISTS preview_blurb text,
  ADD COLUMN IF NOT EXISTS listing_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS price_rationale jsonb,
  ADD COLUMN IF NOT EXISTS compare_at_price numeric,
  ADD COLUMN IF NOT EXISTS category_slug text;

CREATE INDEX IF NOT EXISTS ebooks_listing_status_idx ON public.ebooks(listing_status);
CREATE INDEX IF NOT EXISTS ebooks_category_slug_idx ON public.ebooks(category_slug);
