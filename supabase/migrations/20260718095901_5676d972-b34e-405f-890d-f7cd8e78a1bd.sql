update ebooks_kids
set listing_status = 'live',
    sellable = true,
    blocker_reason = null,
    pipeline_status = 'queued',
    metadata = (metadata - 'coloring_cover_invocations' - 'coloring_cover' - 'coloring_cover_pending_verify')
      || jsonb_build_object(
        'coloring_current_step_label','Cover swap — 1088x1408 native full-bleed regen',
        'needs_asset_repair', true,
        'coloring_cover_reset_at', to_jsonb(now())
      )
where id='c2839b88-d900-4f69-bdd9-de748df24d9a';