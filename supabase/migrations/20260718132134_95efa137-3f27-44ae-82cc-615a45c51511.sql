GRANT SELECT ON public.blog_posts TO anon, authenticated;
GRANT ALL ON public.blog_posts TO service_role;
GRANT SELECT ON public.blog_keywords TO anon, authenticated;
GRANT ALL ON public.blog_keywords TO service_role;