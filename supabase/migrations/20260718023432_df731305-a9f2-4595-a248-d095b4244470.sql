
UPDATE autopilot_kids_runs
SET status='running', current_step='generate_cover', updated_at=NOW()
WHERE id IN ('88a9a197-d1d3-4b6b-8da4-3738f796a316','2898f3b8-c1bc-40f8-8089-91afbd1a9efb');
