
CREATE POLICY "admin read ebook buckets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('ebook-pdfs','ebook-covers') AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin write ebook buckets" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('ebook-pdfs','ebook-covers') AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin update ebook buckets" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('ebook-pdfs','ebook-covers') AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete ebook buckets" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('ebook-pdfs','ebook-covers') AND public.has_role(auth.uid(),'admin'));
