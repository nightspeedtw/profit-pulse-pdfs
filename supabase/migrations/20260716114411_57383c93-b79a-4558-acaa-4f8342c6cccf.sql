
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, sort_index, metadata)
VALUES (
  'anatomy_imagination_vs_deformity',
  1,
  E'Anatomy verifier rubric (permanent owner law, 2026-07-16):\n\nTIER 1 - DEFORMITY = ALWAYS FAIL\n  Wrong COUNT of standard parts (4-legged animal with 5 legs, hand with 6 fingers, 3 eyes), fused / missing / extra / severed limbs, disembodied parts, broken incoherent bodies, grotesque proportions that read as injured or disabled. Species-plan violations for realistic subjects (cetacean flukes vertical, stegosaurus bipedal, narwhal tusk on forehead).\n\nTIER 2 - CUTE STYLIZATION = ALWAYS PASS\n  Anthropomorphic charm is welcome everywhere and is NEVER a defect: eyelashes on any animal, big sparkly eyes, smiles, blush marks, bows / hats / props / clothing, expressive faces, cartoon simplification. The verifier must not list any of these as defects.\n\nTIER 3 - COHERENT FANTASY = PASS WHEN INTENTIONAL\n  Unicorns (exactly one forehead horn), pegasus (two wings), mermaids (one human torso + one fish tail with five fingers per hand), dragons, fairies. PASS when either (a) the checklist has fantasy:true or (b) the page''s category_key is a fantasy category. In strictly realistic categories, an UNINVITED fantasy addition on a real species is a Tier 1 fail; a fantasy creature''s own anatomy is judged by fantasy canon, not real biology.',
  'seed',
  'anatomy',
  10,
  jsonb_build_object(
    'law', true,
    'effective_at', '2026-07-16',
    'verifier_version', 'v3:imagination_vs_deformity',
    'fantasy_species_seeded', jsonb_build_array('mermaid','unicorn','pegasus','dragon','fairy')
  )
)
ON CONFLICT (skill_key, version) DO UPDATE
  SET content_md = EXCLUDED.content_md,
      metadata   = EXCLUDED.metadata,
      updated_at = now();

UPDATE public.learned_prevention_rules
   SET status = 'deprecated'
 WHERE status = 'active'
   AND (
        positive_clause ILIKE '%eyelash%'
     OR negative_clause ILIKE '%eyelash%'
     OR positive_clause ILIKE '%humanized%'
     OR negative_clause ILIKE '%humanized%'
     OR positive_clause ILIKE '%no smile%'
     OR negative_clause ILIKE '%no smile%'
     OR positive_clause ILIKE '%no blush%'
     OR negative_clause ILIKE '%no blush%'
   );

UPDATE public.ebooks_kids
   SET metadata = jsonb_set(
         metadata,
         '{coloring_pages}',
         COALESCE(
           (
             SELECT jsonb_agg(
               CASE
                 WHEN pg ? 'anatomy_verdict'
                      AND (pg -> 'anatomy_verdict' ->> 'measured_version') IS DISTINCT FROM 'v3:imagination_vs_deformity'
                 THEN pg - 'anatomy_verdict'
                 ELSE pg
               END
             )
             FROM jsonb_array_elements(metadata -> 'coloring_pages') AS pg
           ),
           metadata -> 'coloring_pages'
         )
       )
 WHERE metadata ? 'coloring_pages'
   AND jsonb_typeof(metadata -> 'coloring_pages') = 'array';
