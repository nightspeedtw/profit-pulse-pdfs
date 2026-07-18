
CREATE TABLE public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  dek text,
  category text,
  hero_image_url text,
  body_md text NOT NULL,
  faq jsonb DEFAULT '[]'::jsonb,
  primary_keyword text,
  secondary_keywords text[] DEFAULT ARRAY[]::text[],
  product_ids uuid[] DEFAULT ARRAY[]::uuid[],
  word_count int DEFAULT 0,
  meta_description text,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blog_posts_status_pub_idx ON public.blog_posts (status, published_at DESC);
CREATE INDEX blog_posts_category_idx ON public.blog_posts (category);

GRANT SELECT ON public.blog_posts TO anon, authenticated;
GRANT ALL ON public.blog_posts TO service_role;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view published blog posts" ON public.blog_posts
  FOR SELECT USING (status = 'published');
CREATE POLICY "Admins can manage blog posts" ON public.blog_posts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER blog_posts_set_updated_at BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.blog_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL UNIQUE,
  keyword_type text NOT NULL DEFAULT 'long_tail',
  intent text NOT NULL DEFAULT 'commercial',
  category text,
  age_band text,
  times_used int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blog_keywords_usage_idx ON public.blog_keywords (times_used ASC, last_used_at NULLS FIRST);

GRANT SELECT ON public.blog_keywords TO anon, authenticated;
GRANT ALL ON public.blog_keywords TO service_role;
ALTER TABLE public.blog_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view keywords" ON public.blog_keywords FOR SELECT USING (true);
CREATE POLICY "Admins can manage keywords" ON public.blog_keywords
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
