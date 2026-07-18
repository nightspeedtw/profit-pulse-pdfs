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
    pipeline_status = 'queued'
where id = 'c2839b88-a0ec-4c3b-a10c-95cd3f9ab7c9';