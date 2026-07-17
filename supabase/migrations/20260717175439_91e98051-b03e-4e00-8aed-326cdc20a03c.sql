SET LOCAL app.allow_identity_override = 'on';
UPDATE public.ebooks_kids
SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
  'focus_run', true,
  'qc_mode_override', 'learning'
)
WHERE id='ac105009-b610-402c-95fd-8195579adc05';