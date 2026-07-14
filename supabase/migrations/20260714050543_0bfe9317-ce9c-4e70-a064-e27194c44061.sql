
CREATE OR REPLACE VIEW public.ebook_costs AS
SELECT
  ebook_id,
  SUM(cost_usd)::numeric(12,4) AS total_usd,
  SUM(CASE WHEN model ILIKE '%image%' OR model ILIKE '%flux%' OR model ILIKE '%recraft%' THEN cost_usd ELSE 0 END)::numeric(12,4) AS image_usd,
  SUM(CASE WHEN NOT (model ILIKE '%image%' OR model ILIKE '%flux%' OR model ILIKE '%recraft%') THEN cost_usd ELSE 0 END)::numeric(12,4) AS text_usd,
  SUM(CASE WHEN model ILIKE '%image%' OR model ILIKE '%flux%' OR model ILIKE '%recraft%' THEN output_tokens ELSE 0 END)::int AS n_images,
  COUNT(*)::int AS n_calls,
  MAX(created_at) AS last_call_at
FROM public.cost_log
WHERE ebook_id IS NOT NULL
GROUP BY ebook_id;

GRANT SELECT ON public.ebook_costs TO authenticated;
GRANT SELECT ON public.ebook_costs TO service_role;

INSERT INTO public.pipeline_skills (skill_key, version, content_md, source, sort_index, metadata)
VALUES (
  'cost_policy',
  1,
  E'# Cost & model tiering policy\n\nPro-tier models are reserved for judgment / QC / visual-bible steps only.\nEverything else uses flash. Never change quality thresholds, image resolution, or reference conditioning to cut cost.',
  'seed',
  50,
  jsonb_build_object(
    'pro_only', jsonb_build_array('story_gate_judge','final_qc_scorecard','vision_qc_batch','visual_bible'),
    'flash_default', 'google/gemini-2.5-flash',
    'flash_used_by', jsonb_build_array('concept','scene_plan','draft','revision','storefront_copy','final_text_repair','vision_qc_page'),
    'image_default', 'google/gemini-3.1-flash-image',
    'image_resolution', 1024,
    'never_change', jsonb_build_array('story_gate_thresholds','final_qc_thresholds','image_resolution','reference_conditioning')
  )
)
ON CONFLICT (skill_key, version) DO UPDATE SET content_md = EXCLUDED.content_md, metadata = EXCLUDED.metadata, updated_at = now();
