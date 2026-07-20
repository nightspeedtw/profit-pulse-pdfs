
CREATE TABLE IF NOT EXISTS public.drive_import_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  root_folder_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  default_price_cents integer NOT NULL DEFAULT 2499,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.drive_import_config TO authenticated;
GRANT ALL ON public.drive_import_config TO service_role;
ALTER TABLE public.drive_import_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read drive config" ON public.drive_import_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.drive_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id text NOT NULL UNIQUE,
  drive_modified_time timestamptz,
  drive_parent_folder_id text,
  drive_parent_folder_name text,
  category text NOT NULL DEFAULT 'storybook' CHECK (category IN ('coloring','storybook')),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  price_cents integer NOT NULL DEFAULT 2499,
  pdf_url text,
  pdf_storage_path text,
  cover_url text,
  file_size_bytes bigint,
  sha256 text,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live','draft','archived','error')),
  import_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.drive_products TO anon, authenticated;
GRANT ALL ON public.drive_products TO service_role;
ALTER TABLE public.drive_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read live drive products" ON public.drive_products FOR SELECT TO anon, authenticated USING (status = 'live');
CREATE POLICY "admins read all drive products" ON public.drive_products FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_drive_products_category ON public.drive_products(category, status);
CREATE INDEX IF NOT EXISTS idx_drive_products_created_at ON public.drive_products(created_at DESC);

CREATE TRIGGER drive_products_updated_at BEFORE UPDATE ON public.drive_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER drive_import_config_updated_at BEFORE UPDATE ON public.drive_import_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
