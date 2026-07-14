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

async function dispatchSupervisor(row: { id: string; title?: string | null; pipeline_status?: string | null }): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 25_000);
  try {
    // Synchronous supervisor call so we see the ACTUAL decision (resumed /
    // no_op / shelved / repaired / error) instead of just 202-accepted. That
    // makes silent declines visible in watchdog logs.
    const r = await fetch(`${SUPABASE_URL}/functions/v1/kids-repair-supervisor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ ebook_id: row.id, source: 'kids-autopilot-watchdog' }),
      signal: ctl.signal,
    });
    const t = await r.text().catch(() => '');
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(t); } catch { parsed = { raw: t.slice(0, 240) }; }
    const summary = {
      ebook_id: row.id,
      title: row.title ?? null,
      status_before: row.pipeline_status ?? null,
      http_status: r.status,
      result: parsed.result ?? null,
      kind: parsed.kind ?? null,
      blocker_class: parsed.blocker_class ?? null,
      reason: parsed.reason ?? null,
      handler: parsed.handler ?? null,
    };
    console.log('watchdog supervisor decision', JSON.stringify(summary));
    return summary;
  } catch (e) {
    const err = { ebook_id: row.id, error: String((e as Error).message ?? e) };
    console.error('watchdog supervisor dispatch failed', JSON.stringify(err));
    return { ...err, result: 'error' };
  } finally {
    clearTimeout(timeout);
  }
}

async function resumeParentRun(row: { id: string }) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/kids-one-click-build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ resume_parent_run_id: row.id, age_band: '4-6' }),
    });
    const t = await r.text().catch(() => '');
    console.log('watchdog resumed parent run', JSON.stringify({ run_id: row.id, status: r.status, body: t.slice(0, 240) }));
  } catch (e) {
    console.error('watchdog parent resume failed', JSON.stringify({ run_id: row.id, error: String((e as Error).message ?? e) }));
  }
}

async function scanAndDispatch() {
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

    console.log('watchdog scan complete', JSON.stringify({ checked_at: new Date().toISOString(), stuck_count: stuck?.length ?? 0 }));
    const decisions = await Promise.all((stuck ?? []).map(dispatchSupervisor));
    console.log('watchdog decisions summary', JSON.stringify({ n: decisions.length, decisions }));

    const { data: parentRuns, error: parentErr } = await db
      .from('autopilot_kids_runs')
      .select('id, updated_at, status, current_step')
      .eq('status', 'running')
      .eq('current_step', 'parent_job')
      .lt('updated_at', twentyMinAgo)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (parentErr) throw parentErr;

    // Singleton enforcement: at most ONE active parent run at any time.
    // If any parent run is already active AND fresh (updated within 20 min), do NOT revive anyone.
    // Otherwise revive only the single newest stuck run.
    const { data: freshActive } = await db
      .from('autopilot_kids_runs')
      .select('id')
      .in('status', ['queued', 'running'])
      .eq('current_step', 'parent_job')
      .gte('updated_at', twentyMinAgo)
      .limit(1);
    const eligibleForResume = (parentRuns ?? []).slice(0, (freshActive?.length ?? 0) > 0 ? 0 : 1);
    console.log('watchdog parent scan complete', JSON.stringify({
      stuck_parent_count: parentRuns?.length ?? 0,
      fresh_active_count: freshActive?.length ?? 0,
      will_revive: eligibleForResume.length,
    }));
    await Promise.allSettled(eligibleForResume.map(resumeParentRun));
  } catch (e) {
    console.error('kids-autopilot-watchdog error', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const task = scanAndDispatch();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task); else task.catch((e) => console.error('watchdog background error', e));
  return json({ ok: true, accepted: true, checked_at: new Date().toISOString() }, 202);
});
