SET LOCAL app.allow_identity_override='on';
UPDATE ebooks_kids
SET title='Roaring Dinosaurs',
    subtitle='A Coloring Adventure',
    metadata = (metadata - 'coloring_cover_single_attempt' - 'coloring_cover_ideogram_attempts' - 'coloring_cover_ladder' - 'coloring_blocker')
      || jsonb_build_object(
        'coloring_current_step_label','Interior-first + clean-title cover regen',
        'coloring_last_dispatched_at', NULL,
        'awaiting','cover_pdf_publish',
        'focus_run', true,
        'qc_mode_override','strict'
      ),
    blocker_reason=NULL,
    pipeline_status='queued'
WHERE id='05792915-65c5-4691-9f1c-88ac760b0aab';