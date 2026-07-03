
CREATE TABLE public.cover_style_reference (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  palette JSONB NOT NULL DEFAULT '[]'::jsonb,
  lighting TEXT,
  layout_notes TEXT,
  style_summary TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cover_style_reference TO authenticated;
GRANT ALL ON public.cover_style_reference TO service_role;
ALTER TABLE public.cover_style_reference ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view refs" ON public.cover_style_reference FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE UNIQUE INDEX cover_style_reference_one_active ON public.cover_style_reference (is_active) WHERE is_active;
