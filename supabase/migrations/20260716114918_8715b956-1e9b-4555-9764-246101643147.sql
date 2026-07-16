
INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, target_dimension, sort_index, metadata)
VALUES (
  'anatomy_deformity_only_v2',
  1,
  E'Anatomy verifier doctrine (permanent owner law, 2026-07-16 v2 — supersedes anatomy_imagination_vs_deformity):\n\nThe anatomy gate answers ONE question about each image:\n"Would a parent see this creature as broken, injured, disabled, or malformed — rather than merely stylized or fantastical?"\n\nFAIL only for real deformity of the depicted creature''s OWN canonical form:\n  - wrong COUNT of that creature''s standard parts (5 legs on a 4-legged being, 6 fingers on a human hand, 3 arms on a human, 3 eyes on one head)\n  - fused / missing / extra / severed / floating / disembodied limbs\n  - broken, incoherent, or Frankenstein-stitched bodies\n  - grotesque injured-looking proportions (crushed, twisted, mangled)\n\nPASS everything else. Explicitly PASS:\n  - cuteness & stylization (eyelashes, big sparkly eyes, smiles, blush, bows, hats, clothing, cartoon simplification)\n  - ALL imaginary beings in ANY category — mythical creatures, legends, fantasy, humans, gods / deities, divine beasts, spirits, hybrids. Anatomy does NOT police theme.\n  - canonical mythical / divine forms: unicorn (1 forehead horn), pegasus (2 wings), mermaid (torso + fish tail), dragon, phoenix, fairy, naga (multi-headed serpent — 1/3/5/7/9 heads canonical), garuda (bird-human), kinnari (half-bird half-human), erawan / airavata (multi-headed elephant, up to 33 heads), nine-tailed fox / kitsune (up to 9 tails canonical), kirin, multi-armed deities (4/6/8/… arms in iconography = correct).\n\nCategory / theme fit is a SEPARATE gate (allowed_subjects). Anatomy no longer polices it — the v1 "uninvited fantasy in realistic categories fails ANATOMY" clause is REMOVED.',
  'seed',
  'anatomy',
  10,
  jsonb_build_object(
    'law', true,
    'effective_at', '2026-07-16',
    'verifier_version', 'v4:deformity_only',
    'supersedes', 'anatomy_imagination_vs_deformity',
    'mythical_species_seeded', jsonb_build_array('mermaid','unicorn','pegasus','dragon','fairy','phoenix','naga','garuda','kinnari','erawan','nine_tailed_fox','kirin','deity','human')
  )
)
ON CONFLICT (skill_key, version) DO UPDATE
  SET content_md = EXCLUDED.content_md,
      metadata   = EXCLUDED.metadata,
      updated_at = now();

-- Retire the previous law so retrieval returns only the current doctrine.
UPDATE public.pipeline_skills
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object(
                       'superseded_by', 'anatomy_deformity_only_v2',
                       'superseded_at', now()
                     )
 WHERE skill_key = 'anatomy_imagination_vs_deformity';

-- Clear anatomy verdicts stamped with pre-v4 rubric so they re-measure
-- under the deformity-only doctrine (no re-render cost).
UPDATE public.ebooks_kids
   SET metadata = jsonb_set(
         metadata,
         '{coloring_pages}',
         COALESCE(
           (
             SELECT jsonb_agg(
               CASE
                 WHEN pg ? 'anatomy_verdict'
                      AND (pg -> 'anatomy_verdict' ->> 'measured_version') IS DISTINCT FROM 'v4:deformity_only'
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
