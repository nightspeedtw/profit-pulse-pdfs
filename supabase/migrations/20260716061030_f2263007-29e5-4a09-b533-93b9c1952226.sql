UPDATE public.ebooks_kids
SET metadata = jsonb_set(
    jsonb_set(
      metadata,
      '{coloring_sharpness_calibration}',
      jsonb_build_object(
        'floor', 15.0,
        'measured_at', to_jsonb(now()),
        'accepted_distribution', jsonb_build_object('n',30,'min',13.55,'p10',18.16,'median',27.80,'p90',46.27,'max',48.04),
        'accepted_below_floor_pages', jsonb_build_array(3),
        'failing_regen_pages', jsonb_build_array(19,31),
        'decision', 'floor_correct_upgrade_repair_regime',
        'repair_regime', jsonb_build_object('num_inference_steps',8,'clauses',jsonb_build_array('crisp vector-like outlines','high contrast','no blur'))
      ),
      true
    ),
    '{coloring_repair_attempts}',
    (coalesce(metadata->'coloring_repair_attempts','{}'::jsonb) || jsonb_build_object('19', to_jsonb(0), '31', to_jsonb(0))),
    true
  ),
  updated_at = now()
WHERE id = 'a05a5086-8972-4b9e-8953-ee9dfa633d64';