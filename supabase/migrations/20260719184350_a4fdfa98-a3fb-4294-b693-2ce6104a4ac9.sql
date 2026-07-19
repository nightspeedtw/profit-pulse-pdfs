DO $$
BEGIN
  PERFORM set_config('app.allow_live_assets_override', 'on', true);
  PERFORM set_config('app.allow_terminal_override',    'on', true);
  PERFORM set_config('app.allow_identity_override',    'on', true);

  UPDATE public.ebooks_kids
     SET metadata = jsonb_set(
           metadata,
           '{coloring_pages}',
           COALESCE((
             SELECT jsonb_agg(elem)
               FROM jsonb_array_elements(metadata->'coloring_pages') elem
              WHERE (elem->>'page')::int NOT IN (7,14,27)
           ), '[]'::jsonb)
         ),
         pipeline_status = 'queued',
         listing_status  = 'draft',
         sellable        = false,
         blocker_reason  = 'anatomy_deformity_hard_gate_v1: regenerating pages 7/14/27'
   WHERE id = 'd6da92a8-5eaa-455e-9d00-8b8780cae9d1';

  UPDATE public.ebooks_kids
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                  #- '{coloring_repair_attempts,7}'
                  #- '{coloring_repair_attempts,14}'
                  #- '{coloring_repair_attempts,27}'
   WHERE id = 'd6da92a8-5eaa-455e-9d00-8b8780cae9d1';
END $$;

INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, metadata)
VALUES (
  'anatomy_deformity_hard_gate_v1',
  1,
  '# anatomy_deformity_hard_gate_v1 (owner 2026-07-19) — Deformity (missing/extra/fused/floating/severed/disembodied limbs, wrong count, mangled body) is a NON-WAIVABLE hard reject for coloring interior pages. Fantasy species canon, stylization, cuteness, chibi, eyelashes, blush, canonical mythical forms (unicorn horn, nine tails, multi-armed deities, multi-head elephant) still PASS. Enforcement: coloring-book-render deletes storage and drops the page from newRecords; repair ladder regenerates only that page. Verifier version v6:deformity_hard_gate.',
  'seed',
  jsonb_build_object(
    'verifier_version', 'v6:deformity_hard_gate',
    'amends', 'coloring_rulebook_v2',
    'regression_test', 'src/__tests__/coloring-anatomy-deformity-hard-gate.test.ts'
  )
)
ON CONFLICT DO NOTHING;