UPDATE ebooks_kids
SET metadata = metadata
  || jsonb_build_object('trim_profile', 'square_8_5')
  || jsonb_build_object('trim_profile_stamp', jsonb_build_object('profile','square_8_5','stamped_at', to_jsonb(now()), 'source','manual_restore_after_prune'))
  || jsonb_build_object('coloring_format', 'square_8_5')
WHERE id = 'd6da92a8-5eaa-455e-9d00-8b8780cae9d1';