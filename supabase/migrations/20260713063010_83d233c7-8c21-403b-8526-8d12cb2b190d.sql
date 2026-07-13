CREATE TABLE public.kids_style_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  prompt_suffix TEXT NOT NULL,
  negative_prompt TEXT DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 10,
  enabled BOOLEAN NOT NULL DEFAULT true,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kids_style_presets TO authenticated;
GRANT ALL ON public.kids_style_presets TO service_role;
ALTER TABLE public.kids_style_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read styles authed" ON public.kids_style_presets FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage styles" ON public.kids_style_presets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER kids_style_presets_updated BEFORE UPDATE ON public.kids_style_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.kids_style_presets (slug, label, prompt_suffix, negative_prompt, weight) VALUES
('watercolor_soft', 'Soft Watercolor', 'in soft watercolor picture-book style, pastel palette, gentle textured brush strokes, warm lighting, hand-painted feel, whimsical children''s book illustration, no text', 'photo, 3d render, harsh outlines, dark, scary, text, logo, watermark', 10),
('ghibli_hand_drawn', 'Hand-Drawn Animation', 'in hand-drawn 2D animation cel style, lush painterly backgrounds, expressive characters, cinematic warm light, cozy children''s book illustration, no text', 'photo, 3d, cgi, scary, text, watermark', 10),
('pixar_3d', '3D Pixar-Like', 'in 3D rendered children''s movie style, soft global illumination, rounded friendly shapes, cinematic composition, adorable characters, no text', 'photo, flat, sketch, scary, text, watermark', 10),
('flat_vector', 'Flat Vector', 'in flat vector illustration style, bold clean shapes, limited palette, playful geometric composition, modern children''s book, no text', 'photo, 3d, realistic, scary, text, watermark', 10),
('crayon_texture', 'Crayon & Colored Pencil', 'in crayon and colored pencil texture style, visible paper grain, hand-scribbled charm, warm cozy palette, children''s picture book, no text', 'photo, 3d, digital-clean, scary, text, watermark', 10),
('gouache_painterly', 'Gouache Painterly', 'in gouache painterly illustration style, thick opaque brush strokes, saturated warm palette, storybook composition, no text', 'photo, 3d, thin lines, scary, text, watermark', 10);

ALTER TABLE public.kids_book_bibles
  ADD COLUMN IF NOT EXISTS style_preset_id UUID REFERENCES public.kids_style_presets(id),
  ADD COLUMN IF NOT EXISTS style_slug TEXT,
  ADD COLUMN IF NOT EXISTS character_reference_image_url TEXT;