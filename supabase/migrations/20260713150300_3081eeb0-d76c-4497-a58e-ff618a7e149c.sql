
UPDATE public.kids_style_presets SET weight = 50 WHERE slug = 'watercolor_soft';
UPDATE public.kids_style_presets SET weight = 25 WHERE slug = 'gouache_painterly';
UPDATE public.kids_style_presets SET weight = 0, enabled = false WHERE slug = 'pixar_3d';
UPDATE public.kids_style_presets SET weight = 10 WHERE slug IN ('crayon_texture','flat_vector','ghibli_hand_drawn');
