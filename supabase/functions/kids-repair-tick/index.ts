// Kids repair tick.
//
// Fire-and-forget loop that polls run status, invokes the supervisor when
// blocked, and exits when the book is either live or shelved. Hard-capped
// iterations so it can never loop forever.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_TICKS = 20;
const TICK_INTERVAL_MS = 20_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function invoke(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, body: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, body: text.slice(0, 400) }; }
}

async function loop(ebook_id: string, run_id: string | null) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  for (let i = 0; i < MAX_TICKS; i++) {
    await new Promise(r => setTimeout(r, TICK_INTERVAL_MS));
    const { data: e } = await db.from('ebooks_kids')
      .select('id, listing_status, sellable, pipeline_status, storefront_meta').eq('id', ebook_id).single();
    if (!e) return;
    if (e.listing_status === 'live' && e.sellable) return;

    const meta = (e.storefront_meta as Record<string, unknown> | null) ?? {};
    const shelved = Boolean(meta.shelved);
    if (shelved) return;

    let latestRunStatus: string | null = null;
    let latestRunCurrentStep: string | null = null;
    if (run_id) {
      const { data: r } = await db.from('autopilot_kids_runs').select('status, current_step').eq('id', run_id).maybeSingle();
      latestRunStatus = (r?.status as string | undefined) ?? null;
      latestRunCurrentStep = (r?.current_step as string | undefined) ?? null;
    }

    const pipeStatus = String(e.pipeline_status ?? '');
    const runIsIdle = latestRunStatus === 'failed' || latestRunStatus === 'completed' || latestRunStatus === null;
    const bookIsBlocked = pipeStatus === 'human_review_required' || pipeStatus === 'needs_revision';

    // Trigger the supervisor only when the run has stopped moving AND we don't
    // already show live. If the pipeline is still running (or a chained stage
    // is), wait a tick.
    if (runIsIdle || bookIsBlocked) {
      const res = await invoke('kids-repair-supervisor', { ebook_id, run_id });
      const result = (res.body as { result?: string } | string | null);
      const finalResult = typeof result === 'object' && result ? (result as { result?: string }).result : null;
      if (finalResult === 'shelved' || finalResult === 'published') return;
      // else: keep looping — supervisor either dispatched a repair or resumed the pipeline.
    }
    // Steps in flight: continue polling.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const ebook_id: string = body.ebook_id;
    const run_id: string | null = body.run_id ?? null;
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) {
      rt.waitUntil(loop(ebook_id, run_id));
    } else {
      loop(ebook_id, run_id).catch(e => console.error('tick loop error', e));
    }
    return json({ ok: true, ebook_id, run_id, ticking: true, max_ticks: MAX_TICKS, tick_interval_ms: TICK_INTERVAL_MS });
  } catch (e) {
    console.error('kids-repair-tick error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
