## Diagnosis

Both failures come from the same edge function: `admin-data` (resources `kids_runs` for "Recent runs" and `kids_library` for "Kids Library"). Neither is a UI bug — the function is throwing before it can respond.

Confirmed this turn:
- `supabase--cloud_status` → `ACTIVE_HEALTHY` (backend claims fine).
- `supabase--read_query "SELECT 1"` → 544 "Connection terminated due to connection timeout".
- `supabase--db_health` → metrics endpoint also times out.

Meaning the Postgres pooler is wedged even though the control-plane says healthy — the same infra-side outage that hit `coloring-autopilot-config` last turn. Every `admin-data` resource does 3–5 parallel selects against that pooler, so they all hang past the 150s edge gateway limit and the client sees "Edge Function returned a non-2xx status code". The "0 kids books" line is just the initial React state before the failed load — not a data-loss signal.

## Plan

1. **Recover the backend** (requires your approval — it's a destructive-ish op):
   - Call `supabase--restart` on the Lovable Cloud instance.
   - Poll `supabase--cloud_status` + a `SELECT 1` until both succeed.
   - Re-hit `admin-data` for `kids_runs` and `kids_library` to confirm the two panels load.

2. **Harden `admin-data` so a wedged pooler produces a useful response instead of a 150s hang** (applies the same pattern already shipped in `coloring-autopilot-config`):
   - Wrap each sub-query in `kids_runs` and `kids_library` handlers with an 8s `Promise.race` timeout.
   - On per-query timeout: return `null`/`[]` for that slice and include a `partial: true` + `degraded: [<slice names>]` field in the JSON response.
   - Keep the overall handler well under the 150s gateway ceiling.
   - Frontend (`KidsAutopilot.tsx`, `KidsLibrary.tsx`): when `partial` is true, render what came back and show a small "backend degraded — some panels unavailable" banner instead of the full-page "Load failed" state.

3. **No other code changes.** Do not touch pipeline logic, gates, or generation config in this turn.

### Technical notes
- The 8s per-query cap × 5 parallel queries stays under gateway limits even in the worst case, because `Promise.all` on parallel racers resolves at max(timeouts) ≈ 8s.
- Partial-response shape is additive; existing callers that ignore `partial`/`degraded` keep working.
- Restart typically takes 2–5 minutes; during that window the admin panels will still show the degraded banner rather than a hard error.

## Not doing (out of scope this turn)
- Cover-primary flip back to `gpt-image-1` (deferred — needs DB writes).
- Resuming test book `c2839b88` and reporting metrics (deferred — needs DB reads/writes).
Both remain queued and will run immediately after the pooler is verified healthy.

**Approve to (a) restart the Lovable Cloud backend and (b) ship the `admin-data` timeout + partial-response hardening?**