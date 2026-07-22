ALTER TABLE public.seo_autopilot_settings
  ADD COLUMN IF NOT EXISTS max_blog_posts_per_month integer NOT NULL DEFAULT 8;