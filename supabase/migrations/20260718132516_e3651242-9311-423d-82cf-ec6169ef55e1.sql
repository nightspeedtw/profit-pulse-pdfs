GRANT SELECT ON public.blog_posts TO anon;
GRANT SELECT ON public.blog_posts TO authenticated;
GRANT ALL ON public.blog_posts TO service_role;

GRANT SELECT ON public.blog_keywords TO anon;
GRANT SELECT ON public.blog_keywords TO authenticated;
GRANT ALL ON public.blog_keywords TO service_role;