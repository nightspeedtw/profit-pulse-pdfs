UPDATE public.ebooks_kids
SET cover_url = NULL,
    thumbnail_url = NULL,
    pipeline_status = 'queued',
    listing_status = 'draft',
    sellable = false,
    blocker_reason = NULL,
    metadata = (COALESCE(metadata,'{}'::jsonb) - 'ideogram_cover' - 'canva' - 'coloring_last_dispatched_at')
      || jsonb_build_object(
        'focus_run', true,
        'cover_regen_requested_at', to_jsonb(now())
      )
WHERE id = '607018e8-9190-4c30-b4ef-538a0fa999c9';