UPDATE public.ebooks_kids
SET cover_url = NULL,
    thumbnail_url = NULL,
    blocker_reason = NULL,
    pipeline_status = 'queued',
    listing_status = 'draft',
    sellable = false,
    metadata = COALESCE(metadata, '{}'::jsonb)
      - 'coloring_cover'
      - 'coloring_cover_gate'
      - 'coloring_cover_single_attempt'
      - 'coloring_cover_ideogram_attempts'
      - 'coloring_thumbnail'
      || jsonb_build_object(
        'awaiting', 'cover_pdf_publish',
        'focus_run', true,
        'coloring_last_dispatched_at', NULL,
        'coloring_current_step_label', 'Reset for interior-first cover regen (character continuity law)'
      )
WHERE id = '607018e8-9190-4c30-b4ef-538a0fa999c9';