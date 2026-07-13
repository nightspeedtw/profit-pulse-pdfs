
CREATE TABLE public.product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_id uuid NOT NULL REFERENCES public.ebooks(id) ON DELETE CASCADE,
  reviewer_name text NOT NULL,
  rating integer NOT NULL,
  comment text,
  verified_purchase boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.product_reviews TO anon, authenticated;
GRANT ALL ON public.product_reviews TO service_role;

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read product reviews"
  ON public.product_reviews FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies for anon/authenticated → only service_role
-- (edge functions / admin) can write. Prevents fake review injection from the client.

CREATE OR REPLACE FUNCTION public.product_reviews_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'rating must be between 1 and 5';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_reviews_validate_trg
  BEFORE INSERT OR UPDATE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.product_reviews_validate();

CREATE INDEX product_reviews_ebook_id_idx ON public.product_reviews (ebook_id, created_at DESC);

-- Aggregate view for fast average + count reads.
CREATE OR REPLACE VIEW public.product_review_stats AS
SELECT
  ebook_id,
  ROUND(AVG(rating)::numeric, 2) AS average_rating,
  COUNT(*)::int AS review_count
FROM public.product_reviews
GROUP BY ebook_id;

GRANT SELECT ON public.product_review_stats TO anon, authenticated;
GRANT ALL ON public.product_review_stats TO service_role;
