UPDATE public.generation_settings
SET paused = false,
    autopilot_enabled = true,
    enabled_categories_json = '[
      {"slug":"finance","weight":2,"enabled":true},
      {"slug":"wellness","weight":1,"enabled":true},
      {"slug":"beginner","weight":1,"enabled":true}
    ]'::jsonb,
    daily_quota = GREATEST(daily_quota, 1),
    updated_at = now()
WHERE id = 1;