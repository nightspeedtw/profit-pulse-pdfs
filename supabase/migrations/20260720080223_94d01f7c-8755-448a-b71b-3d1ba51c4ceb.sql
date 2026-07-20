
INSERT INTO platform_settings (key, value_json)
VALUES ('coloring_v2_autopilot_config', '{"enabled":true,"daily_cap":0,"max_in_flight":0,"page_count":32,"legacy_overlay_sweep":true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json;

UPDATE generation_settings
SET coloring_autopilot = coalesce(coloring_autopilot,'{}'::jsonb) || jsonb_build_object(
  'enabled', true,
  'paused', false,
  'daily_cap', 0,
  'batch_size', 10,
  'max_parallel', 8,
  'daily_cost_cap_usd_coloring', 0
),
daily_budget_usd = 10000
WHERE id = 1;
