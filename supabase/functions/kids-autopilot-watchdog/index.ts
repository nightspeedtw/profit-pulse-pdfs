// Watchdog for stalled kids-book pipelines.
//
// Runs every 10 minutes (via pg_cron). Finds ebooks_kids rows stuck in a
// non-terminal pipeline_status with updated_at older than 20 minutes and
// dispatches kids-repair-supervisor to resume or shelve them.
//
// Terminal statuses (never touched): published, live, retired, exhausted,
// shelved. All other non-live statuses are considered in-flight and eligible.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TERMINAL = ['published', 'live', 'retired', 'exhausted', 'shelved'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();

    const { data: stuck, error } = await db
      .from('ebooks_kids')
      .select('id, title, pipeline_status, listing_status, updated_at')
      .not('pipeline_status', 'in', `(${TERMINAL.map(t => `"${t}"`).join(',')})`)
      .neq('listing_status', 'live')
      .lt('updated_at', twentyMinAgo)
      .limit(20);
    if (error) throw error;

    const dispatched: Array<{ ebook_id: string; title: string; pipeline_status: string; result: unknown }> = [];
    for (const row of stuck ?? []) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/kids-repair-supervisor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ ebook_id: row.id }),
        });
        const t = await r.text();
        let parsed: unknown = t.slice(0, 400);
        try { parsed = JSON.parse(t); } catch { /* keep text */ }
        dispatched.push({ ebook_id: row.id, title: String(row.title ?? ''), pipeline_status: String(row.pipeline_status ?? ''), result: parsed });
      } catch (e) {
        dispatched.push({ ebook_id: row.id, title: String(row.title ?? ''), pipeline_status: String(row.pipeline_status ?? ''), result: { error: String((e as Error).message ?? e) } });
      }
    }

    return json({ ok: true, checked_at: new Date().toISOString(), stuck_count: stuck?.length ?? 0, dispatched });
  } catch (e) {
    console.error('kids-autopilot-watchdog error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
