
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO postgres, service_role, authenticated;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, postgres, service_role;

-- public.* policies
DROP POLICY IF EXISTS "admin all categories" ON public.categories;
CREATE POLICY "admin all categories" ON public.categories FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin all ideas" ON public.ebook_ideas;
CREATE POLICY "admin all ideas" ON public.ebook_ideas FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin all ebooks" ON public.ebooks;
CREATE POLICY "admin all ebooks" ON public.ebooks FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin settings" ON public.generation_settings;
CREATE POLICY "admin settings" ON public.generation_settings FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin read costs" ON public.cost_log;
CREATE POLICY "admin read costs" ON public.cost_log FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin all jobs" ON public.generation_jobs;
CREATE POLICY "admin all jobs" ON public.generation_jobs FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin all autopilot runs" ON public.autopilot_runs;
CREATE POLICY "admin all autopilot runs" ON public.autopilot_runs FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- storage.objects policies
DROP POLICY IF EXISTS "admin read ebook buckets" ON storage.objects;
CREATE POLICY "admin read ebook buckets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY['ebook-pdfs','ebook-covers']) AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin write ebook buckets" ON storage.objects;
CREATE POLICY "admin write ebook buckets" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = ANY (ARRAY['ebook-pdfs','ebook-covers']) AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin update ebook buckets" ON storage.objects;
CREATE POLICY "admin update ebook buckets" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = ANY (ARRAY['ebook-pdfs','ebook-covers']) AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin delete ebook buckets" ON storage.objects;
CREATE POLICY "admin delete ebook buckets" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = ANY (ARRAY['ebook-pdfs','ebook-covers']) AND private.has_role(auth.uid(), 'admin'::public.app_role));

-- Drop the exposed public version
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
