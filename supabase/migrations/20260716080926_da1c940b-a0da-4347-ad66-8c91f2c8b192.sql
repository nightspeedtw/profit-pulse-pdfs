
CREATE TABLE IF NOT EXISTS public.species_anatomy (
  species_key text PRIMARY KEY,
  aliases text[] NOT NULL DEFAULT '{}',
  body_parts jsonb NOT NULL,
  proportion_rules text[] NOT NULL DEFAULT '{}',
  common_ai_failure_modes text[] NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.species_anatomy TO authenticated;
GRANT ALL ON public.species_anatomy TO service_role;

ALTER TABLE public.species_anatomy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "species_anatomy readable to authenticated" ON public.species_anatomy;
CREATE POLICY "species_anatomy readable to authenticated"
  ON public.species_anatomy FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS species_anatomy_set_updated_at ON public.species_anatomy;
CREATE TRIGGER species_anatomy_set_updated_at
  BEFORE UPDATE ON public.species_anatomy
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.species_anatomy (species_key, aliases, body_parts, proportion_rules, common_ai_failure_modes) VALUES
  ('dolphin', ARRAY['dolphin','bottlenose dolphin','porpoise'],
    '{"body":"streamlined torpedo body","dorsal_fin":"exactly ONE dorsal fin, curved backward","pectoral_fins":"exactly TWO pectoral fins (one per side)","tail":"HORIZONTAL two-lobed flukes (never vertical/mermaid/Y-tail)","blowhole":"single blowhole","eye":"one small round eye in profile","mouth":"long narrow rostrum with subtle smile"}'::jsonb,
    ARRAY['body length 6-8x body height','tail flukes horizontal','no legs, no arms, no fingers'],
    ARRAY['vertical mermaid tail','split Y-shaped tail','extra dorsal fins','human-like face with eyelashes']),
  ('fish', ARRAY['fish','tropical fish','reef fish','goldfish'],
    '{"body":"oval or teardrop, symmetric top-to-bottom","dorsal_fin":"one continuous dorsal fin along top","pectoral_fins":"two paired pectoral fins","pelvic_fins":"two pelvic fins on underside","anal_fin":"one anal fin near tail","tail_fin":"caudal fin at peduncle","mouth":"small fish mouth at very front (no bird beak)","eye":"one round eye in profile","gill":"one gill slit behind eye"}'::jsonb,
    ARRAY['body height <= 1.5x body length (pufferfish excepted)','paired fins symmetric','no balloon body, no legs, no arms'],
    ARRAY['balloon/spherical body','beak-like mouth','leaf-shaped fins','asymmetric paired fins']),
  ('whale', ARRAY['whale','humpback whale','blue whale','orca','killer whale'],
    '{"body":"long streamlined body","dorsal_fin":"small dorsal fin or low ridge","pectoral_fins":"two long flippers","tail":"HORIZONTAL two-lobed flukes with center notch","blowhole":"one or two blowholes on top","eye":"one small eye low on side","mouth":"wide mouth line"}'::jsonb,
    ARRAY['flippers ~1/4 body length or less','horizontal flukes, never vertical'],
    ARRAY['vertical tail fin','shark-like body','extra fins']),
  ('shark', ARRAY['shark','great white','hammerhead'],
    '{"body":"streamlined torpedo","dorsal_fin":"one prominent triangular dorsal","pectoral_fins":"two large pectoral fins","tail":"VERTICAL caudal fin, upper lobe longer","gills":"5 gill slits behind eye","mouth":"crescent mouth on underside","eye":"one round eye on side"}'::jsonb,
    ARRAY['no horizontal flukes'],
    ARRAY['dolphin-style horizontal flukes','extra dorsal fins along back']),
  ('octopus', ARRAY['octopus'],
    '{"head":"rounded bulbous mantle","arms":"EXACTLY EIGHT tapering arms with suction cups on underside","eyes":"two eyes on head"}'::jsonb,
    ARRAY['arm count = 8','no bones; arms curl smoothly'],
    ARRAY['wrong arm count','arms fused into skirt','extra eyes']),
  ('seahorse', ARRAY['seahorse','sea horse'],
    '{"head":"horse-like head bent ~90deg, tubular snout","body":"upright ridged body with belly plates","dorsal_fin":"one small fan-shaped dorsal fin","pectoral_fins":"two tiny pectoral fins near head","tail":"prehensile curled tail, no fin at end","eye":"one small round eye on side"}'::jsonb,
    ARRAY['upright posture','tail curls forward, never fish caudal fin'],
    ARRAY['fish tail at end','extra fins','horizontal fish-like body']),
  ('starfish', ARRAY['starfish','sea star'],
    '{"arms":"EXACTLY FIVE arms radiating from central disc","surface":"textured upper surface, tube feet on underside"}'::jsonb,
    ARRAY['radial symmetry','arms of equal length'],
    ARRAY['wrong arm count','unequal arms','eyes/face added']),
  ('jellyfish', ARRAY['jellyfish','jelly'],
    '{"bell":"dome-shaped translucent bell","tentacles":"many long thin trailing tentacles below","oral_arms":"shorter frilly oral arms underside"}'::jsonb,
    ARRAY['tentacles hang downward, wavy','no eyes, no face'],
    ARRAY['cartoon face on bell','tentacles becoming legs/arms']),
  ('sea turtle', ARRAY['sea turtle','turtle'],
    '{"shell":"oval carapace patterned with scutes","flippers":"FOUR flippers (two front, two rear) — never legs with toes","head":"small head with beak-like mouth","eyes":"two eyes","tail":"short pointed tail behind shell"}'::jsonb,
    ARRAY['flipper-shape limbs, not paws'],
    ARRAY['land-tortoise legs with toes','wrong shell shape','extra limbs']),
  ('narwhal', ARRAY['narwhal'],
    '{"body":"streamlined whale-like body","tusk":"ONE straight spiral tusk from upper jaw (males); may be absent (females)","pectoral_fins":"two pectoral flippers","tail":"HORIZONTAL two-lobed flukes","dorsal_ridge":"low dorsal ridge (no tall dorsal fin)","blowhole":"one on top","eye":"one small eye on side"}'::jsonb,
    ARRAY['single tusk only','horizontal flukes'],
    ARRAY['multiple tusks','unicorn horn on forehead','vertical tail']),
  ('crab', ARRAY['crab'],
    '{"body":"wide flat carapace","claws":"TWO front claws","legs":"EIGHT walking legs plus the two claws (ten appendages total)","eyes":"two stalked eyes"}'::jsonb,
    ARRAY['10 appendages total (2 claws + 8 legs)'],
    ARRAY['wrong leg count','extra claws']),
  ('clownfish', ARRAY['clownfish','clown fish','anemonefish'],
    '{"body":"oval fish body, THREE white vertical bands on orange","dorsal_fin":"one continuous dorsal with small notch","pectoral_fins":"two paired pectoral fins","pelvic_fins":"two pelvic fins","tail_fin":"rounded tail fin","mouth":"small fish mouth at front (no beak)","eye":"one round eye on side"}'::jsonb,
    ARRAY['three white bands outlined in black'],
    ARRAY['wrong band count','beak mouth','leaf-shaped fins'])
ON CONFLICT (species_key) DO UPDATE
  SET aliases = EXCLUDED.aliases,
      body_parts = EXCLUDED.body_parts,
      proportion_rules = EXCLUDED.proportion_rules,
      common_ai_failure_modes = EXCLUDED.common_ai_failure_modes,
      updated_at = now();

DELETE FROM public.pipeline_skills WHERE skill_key = 'coloring_species_anatomy_gate_v1';
INSERT INTO public.pipeline_skills (skill_key, source, version, content_md, metadata)
VALUES (
  'coloring_species_anatomy_gate_v1',
  'learned',
  1,
  $md$# Species Anatomy Gate — coloring lane (v1)

Root defect: `anatomy_correctness` was a hardcoded 95 at assemble. Owner shipped defective dolphin/fish because it was never measured. Same class as pre-v2 cover constants.

Three-layer fix:
1. PREVENT — `SPECIES_ANATOMY_SKILL` (`_shared/coloring/species-anatomy.ts` + `species_anatomy` table) gives every allowed_subject a positive checklist. `buildInteriorPrompt` injects it as a positive spec.
2. MEASURE — `verifyAnatomyBatch()` runs Gemini vision on 6-page batches at render time, persists `anatomy_verdict` per page. Failed pages are deleted + requeued via `anatomy_structural` ladder; unmeasured pages block release (never scored 95 by default).
3. REPAIR — `speciesAnatomyRepairClause()` names the exact defects and appends the species checklist to the corrective clauses.

Assemble contract: sweep every legacy page missing a current verdict, block release if ANY page fails or is unmeasured. `anatomy_correctness` at book gate = measured min. Never a constant.

Supersedes prior partial anatomy handling in `coloring_measured_cover_and_assembly_preflight_v1`.
$md$,
  jsonb_build_object(
    'permanent', true,
    'supersedes', ARRAY['coloring_measured_cover_and_assembly_preflight_v1'],
    'code_paths', ARRAY[
      'supabase/functions/_shared/coloring/species-anatomy.ts',
      'supabase/functions/_shared/coloring/anatomy-verify.ts',
      'supabase/functions/_shared/coloring/style-contract.ts',
      'supabase/functions/_shared/coloring/repair-ladder.ts',
      'supabase/functions/coloring-book-render/index.ts',
      'supabase/functions/coloring-book-assemble/index.ts'
    ]
  )
);
