update ebooks_kids
set cover_url = null,
    thumbnail_url = null,
    metadata = (metadata
      - 'coloring_cover'
      - 'coloring_cover_invocations'
      - 'coloring_cover_pending_verify'
      - 'coloring_cover_last_error'
      - 'cover_pending_verify')
      || jsonb_build_object(
        'coloring_current_step_label','Cover regen — native-trim-ratio law',
        'coloring_cover_force_regen_at', to_jsonb(now()),
        'coloring_cover_force_reason','native_trim_ratio_only_law_2026_07_18'
      ),
    blocker_reason = null,
    pipeline_status = 'queued',
    listing_status = 'draft',
    sellable = false
where id = 'c2839b88-d900-4f69-bdd9-de748df24d9a';