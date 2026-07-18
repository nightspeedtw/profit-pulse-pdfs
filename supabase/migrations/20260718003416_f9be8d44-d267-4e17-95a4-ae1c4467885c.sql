UPDATE ebooks_kids
SET metadata = COALESCE(metadata,'{}'::jsonb)
  || jsonb_build_object(
    'coloring_cover_invocations', 0,
    'focus_run', true,
    'qc_mode_override', 'learning',
    'cover_upgrade_pending', true
  ),
  blocker_reason = NULL,
  updated_at = now()
WHERE id IN (
  'd243bb53-cbf6-4ea5-a172-a51efca950d2',
  'ab1f0b77-25ec-43e5-8c61-a1899e007c98',
  'c2839b88-d900-4f69-bdd9-de748df24d9a'
);