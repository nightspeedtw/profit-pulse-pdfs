update ebooks_kids
set listing_status = 'live',
    sellable = true,
    blocker_reason = null,
    pipeline_status = 'queued',
    metadata = metadata || jsonb_build_object(
      'coloring_current_step_label','Cover asset swap — native full-bleed regen (live during swap)',
      'needs_asset_repair', true,
      'asset_repair_reason','owner_requested_native_fullbleed_regen'
    )
where id='c2839b88-d900-4f69-bdd9-de748df24d9a';