update public.ebooks_kids
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
  'focus_run', '2026-07-17-strict-1',
  'qc_mode_override', 'strict'
)
where id = '05792915-65c5-4691-9f1c-88ac760b0aab';