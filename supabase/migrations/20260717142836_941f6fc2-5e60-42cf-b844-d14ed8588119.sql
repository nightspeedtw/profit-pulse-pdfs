UPDATE generation_settings
SET coloring_autopilot = coalesce(coloring_autopilot,'{}'::jsonb) || jsonb_build_object(
  'image_provider_policy', jsonb_build_object(
    'interiors', jsonb_build_object('primary','runware_flux_schnell','fallback','cloudflare_flux_schnell','fallback2', null),
    'covers',    jsonb_build_object('primary','runware_flux_schnell','fallback','cloudflare_flux_schnell','fallback2', null)
  ),
  'fal_disabled_until_owner_confirms', true,
  'fal_disabled_reason', 'owner_directive_2026-07-17: fal.ai billing exhausted; removed from active rotation until owner confirms top-up'
)
WHERE id = 1;