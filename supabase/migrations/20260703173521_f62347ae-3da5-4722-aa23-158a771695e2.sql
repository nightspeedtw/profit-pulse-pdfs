
CREATE POLICY "Admins manage cover style refs" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'cover-style-refs' AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
  WITH CHECK (bucket_id = 'cover-style-refs' AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
