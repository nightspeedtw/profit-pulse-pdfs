
CREATE TABLE public.learned_prevention_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text NOT NULL,
  species_key text NOT NULL,
  gate text NOT NULL,
  positive_clause text NOT NULL,
  negative_clause text NOT NULL DEFAULT '',
  composition_hint text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'learned' CHECK (source IN ('seed','learned','manual')),
  version int NOT NULL DEFAULT 1,
  occurrence_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','rolled_back','shadow')),
  fpy_baseline numeric,
  fpy_after numeric,
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pattern_key, species_key, version)
);
GRANT SELECT ON public.learned_prevention_rules TO authenticated;
GRANT ALL ON public.learned_prevention_rules TO service_role;
ALTER TABLE public.learned_prevention_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read prevention rules" ON public.learned_prevention_rules
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX learned_prevention_rules_lookup_idx
  ON public.learned_prevention_rules (species_key, status);
CREATE INDEX learned_prevention_rules_pattern_idx
  ON public.learned_prevention_rules (pattern_key, species_key);
CREATE TRIGGER learned_prevention_rules_set_updated_at
  BEFORE UPDATE ON public.learned_prevention_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.learned_defect_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text NOT NULL,
  species_key text NOT NULL,
  gate text NOT NULL,
  count int NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_ebook_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pattern_key, species_key)
);
GRANT SELECT ON public.learned_defect_counts TO authenticated;
GRANT ALL ON public.learned_defect_counts TO service_role;
ALTER TABLE public.learned_defect_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read defect counts" ON public.learned_defect_counts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER learned_defect_counts_set_updated_at
  BEFORE UPDATE ON public.learned_defect_counts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.book_first_pass_yield (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebook_kids_id uuid NOT NULL REFERENCES public.ebooks_kids(id) ON DELETE CASCADE,
  fpy numeric NOT NULL,
  first_pass_pages int NOT NULL,
  total_pages int NOT NULL,
  gate_rejections int NOT NULL DEFAULT 0,
  rejections_by_class jsonb NOT NULL DEFAULT '{}'::jsonb,
  measured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.book_first_pass_yield TO authenticated;
GRANT ALL ON public.book_first_pass_yield TO service_role;
ALTER TABLE public.book_first_pass_yield ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read fpy" ON public.book_first_pass_yield
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX book_first_pass_yield_book_idx ON public.book_first_pass_yield (ebook_kids_id, measured_at DESC);

INSERT INTO public.learned_prevention_rules
  (pattern_key, species_key, gate, positive_clause, negative_clause, composition_hint, source, occurrence_count) VALUES
('cetacean_horizontal_flukes','dolphin','anatomy',
  'Tail flukes spread HORIZONTALLY like a whale''s tail, seen from the side; two lobes fanning left-right with a central notch.',
  'NOT a vertical fish-style tail; NOT a mermaid fin; NOT a shark''s upright caudal fin.',
  'Prefer a side-profile composition so horizontal flukes read unambiguously.',
  'seed', 5),
('cetacean_horizontal_flukes','whale','anatomy',
  'Tail flukes spread HORIZONTALLY, two broad lobes fanning left-right with a central notch, viewed from the side.',
  'NOT a vertical fish tail; NOT a shark-style upright caudal fin.',
  'Side-profile composition; flukes clearly parallel to the water surface.',
  'seed', 5),
('cetacean_horizontal_flukes','narwhal','anatomy',
  'Tail flukes spread HORIZONTALLY like a whale''s tail, side view; low dorsal ridge, no tall dorsal fin.',
  'NOT a vertical fish tail; NOT a tall shark-style dorsal.',
  'Side-profile composition preferred.',
  'seed', 5),
('narwhal_tusk_spec','narwhal','anatomy',
  'Exactly ONE straight spiral tusk projecting FORWARD from the UPPER LIP, pointed tip, textured helical grooves along the length.',
  'NOT a unicorn horn on the forehead; NOT bulbous or club-shaped; NOT multiple tusks; NOT missing on a male narwhal scene.',
  'Show the head in three-quarter or side profile so the tusk emerges clearly from the mouth line.',
  'seed', 4),
('seal_two_front_flippers','seal','anatomy',
  'Exactly TWO front flippers (one per side) and TWO rear flippers — four flippers total, no extras.',
  'NOT three front flippers; NOT any extra limb bud; NOT flippers fused to the body.',
  '',
  'seed', 3),
('seal_two_front_flippers','sea lion','anatomy',
  'Exactly TWO front flippers and TWO rear flippers — four total.',
  'NOT three front flippers; NOT extra limbs.',
  '',
  'seed', 3),
('ray_dorsal_view','ray','anatomy',
  'Draw the ray from the DORSAL (top) view or clean side profile; diamond-shaped body, long whip tail trailing behind.',
  'NOT the underside face-up view; NOT a human-like face on the belly.',
  'Top-down dorsal composition is the safest for coloring pages.',
  'seed', 2),
('ray_dorsal_view','stingray','anatomy',
  'Draw the stingray from the DORSAL (top) view; diamond body, whip tail with barb, eyes on top.',
  'NOT the underside face-up view where the mouth reads as a face.',
  'Top-down dorsal composition.',
  'seed', 2),
('sea_water_outline_only','__sea_scene__','solid_black',
  'Water surface and waves rendered as thin outline strokes only; leave water areas OPEN for the child to color.',
  'NOT solid-black-filled water; NOT dense hatch fill inside water regions; NOT gradient shading.',
  'Water = outline of ripples/waves only, interior of every water region is pure white.',
  'seed', 21);

INSERT INTO public.learned_defect_counts (pattern_key, species_key, gate, count) VALUES
('cetacean_horizontal_flukes','dolphin','anatomy',5),
('cetacean_horizontal_flukes','whale','anatomy',5),
('cetacean_horizontal_flukes','narwhal','anatomy',5),
('narwhal_tusk_spec','narwhal','anatomy',4),
('seal_two_front_flippers','seal','anatomy',3),
('ray_dorsal_view','ray','anatomy',2),
('sea_water_outline_only','__sea_scene__','solid_black',21)
ON CONFLICT (pattern_key, species_key) DO NOTHING;

INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, sort_index, metadata)
VALUES (
  'first_pass_yield_learner_law', 1,
  '# Owner Law: เรียนจากการซ่อม จนสอบผ่านตลอดไป

Every repair is a training signal. When any (species, defect_pattern) occurs
>= 2 times lifetime, the pipeline auto-generates a prevention rule that is
injected into the base prompt for EVERY subsequent page of that species.

- FPY = pages accepted on attempt 1 / total plan pages.
- Ladder targets: >= 85% then >= 95%.
- Each learned rule must show FPY improvement or be rolled back.
- Verifier outages are not defects.
- Model-specific biases become permanent in-prompt counters.',
  'seed', 'craft', 1,
  jsonb_build_object('module','_shared/coloring/first-pass-learner.ts','fpy_targets',jsonb_build_array(85,95))
) ON CONFLICT DO NOTHING;
