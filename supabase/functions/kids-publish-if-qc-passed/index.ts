// Runs measured kids QC and publishes to Internal Store only if strict QC
// passes. Isolated from the PDF builder to keep each Edge worker small.
// No Shopify, no fake reviews, no threshold changes.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function dispatchRepairSupervisor(ebook_id: string, run_id?: string | null) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/kids-repair-supervisor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ebook_id, run_id: run_id ?? undefined, source: 'kids-publish-if-qc-passed' }),
  });
  await r.text().catch(() => '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json();
    const ebook_id: string = body.ebook_id;
    const run_id: string | null = body.run_id ?? null;
    const publish: boolean = body.publish !== false;
    const autoRepairOnFail: boolean = body.auto_repair_on_fail !== false;
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const qcRes = await fetch(`${SUPABASE_URL}/functions/v1/kids-qc-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ ebook_id, run_id, use_cached_story_judge_if_hash_matches: true, auto_repair_on_fail: false }),
    });
    const qcBody = await qcRes.json();
    const sellable = !!qcBody?.verdict?.sellable;

    let publishState = 'not_attempted';
    let supervisorDispatched = false;
    if (publish && sellable) {
      await db.from('ebooks_kids').update({
        listing_status: 'live', status: 'live', pipeline_status: 'published',
      }).eq('id', ebook_id);
      publishState = 'live';
    } else {
      await db.from('ebooks_kids').update({
        listing_status: 'draft', status: 'needs_revision', pipeline_status: 'human_review_required',
        blocker_reason: qcBody?.verdict?.reasons?.join(' | ') ?? 'qc_failed',
      }).eq('id', ebook_id);
      publishState = sellable ? 'draft_publish_disabled' : 'draft_needs_review';
      if (!sellable && autoRepairOnFail) {
        supervisorDispatched = true;
        // @ts-expect-error EdgeRuntime is a Deno Deploy global
        EdgeRuntime.waitUntil(dispatchRepairSupervisor(ebook_id, run_id));
      }
    }

    return json({ ok: true, ebook_id, publishState, verdict: qcBody?.verdict, story_qc_status: qcBody?.story_qc_status, supervisor_dispatched: supervisorDispatched });
  } catch (e) {
    console.error('kids-publish-if-qc-passed error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
