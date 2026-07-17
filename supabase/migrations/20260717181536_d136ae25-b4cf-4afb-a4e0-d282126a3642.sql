
-- Ocean Friends: clear cover/thumbnail/pdf, set focus + learning mode, then regenerate via edge trigger.
UPDATE public.ebooks_kids
SET cover_url = NULL,
    thumbnail_url = NULL,
    pdf_url = NULL,
    pdf_sha256 = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb)
              - 'coloring_cover'
              - 'coloring_assembly'
              || jsonb_build_object('focus_run', true, 'qc_mode_override', 'learning', 'cover_reset_at', now()),
    listing_status = 'draft',
    sellable = false,
    updated_at = now()
WHERE id = 'a05a5086-8972-4b9e-8953-ee9dfa633d64';
