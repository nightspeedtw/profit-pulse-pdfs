
UPDATE ebooks_kids
SET metadata = jsonb_set(
  jsonb_set(
    metadata,
    '{coloring_cover_ladder}',
    jsonb_build_object(
      'rungs', metadata->'coloring_cover_ladder'->'rungs',
      'next_index', 0,
      'ideogram_speed_cursor', 0,
      'reports', '[]'::jsonb,
      'attempts_by_rung', '{}'::jsonb,
      'started_at', to_jsonb(now()::text),
      'updated_at', to_jsonb(now()::text),
      'prior_history_archived_at', to_jsonb(now()::text),
      'prior_reports', metadata->'coloring_cover_ladder'->'reports',
      'prior_attempts_by_rung', metadata->'coloring_cover_ladder'->'attempts_by_rung'
    ),
    true
  ),
  '{coloring_current_step_label}',
  '"Cover ladder reset — awaiting requeue after provider top-up"'::jsonb,
  true
)
WHERE id = 'a05a5086-8972-4b9e-8953-ee9dfa633d64';
