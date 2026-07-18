DROP POLICY IF EXISTS "Admins can manage blog posts" ON public.blog_posts;
CREATE POLICY "Admins can manage blog posts" ON public.blog_posts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage keywords" ON public.blog_keywords;
CREATE POLICY "Admins can manage keywords" ON public.blog_keywords
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));