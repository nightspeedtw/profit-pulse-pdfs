
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS meta_title text,
  ADD COLUMN IF NOT EXISTS schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS seo_queue_id uuid REFERENCES public.seo_content_queue(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS blog_posts_seo_queue_idx ON public.blog_posts(seo_queue_id);
