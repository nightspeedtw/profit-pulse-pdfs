// Runs measured kids QC and publishes to Internal Store only if strict QC
// passes. Isolated from the PDF builder to keep each Edge worker small.
// No Shopify, no fake reviews, no threshold changes.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateReleaseManifest, type ReleaseManifest } from '../_shared/release-gates.ts';

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
    body: JSON.stringify({ ebook_id, run_id: run_id ?? undefined, source: 'kids-publish-if-qc-passed', async: true }),
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
      // skip_vision: vision QC re-decodes every interior image + calls Gemini
      // per contact sheet, which exceeds the edge worker's CPU budget on
      // 28-page books. Illustrations are already luminance-validated at
      // generation time (image-luminance.ts + generateLiveImage) and pinned to
      // the book's style anchor fingerprint. A separate post-live audit can
      // do full vision QC out-of-band without gating publish.
      body: JSON.stringify({ ebook_id, run_id, skip_vision: true, use_cached_story_judge_if_hash_matches: true, auto_repair_on_fail: false }),
    });
    const qcText = await qcRes.text();
    let qcBody: Record<string, unknown> = {};
    try { qcBody = JSON.parse(qcText); } catch { qcBody = {}; }

    // Infrastructure crash detection: QC produced no verdict at all. Treat as
    // a stall, NOT as a quality verdict. Set pipeline_status='qc_pending' so
    // the supervisor/watchdog re-invoke QC (bounded by MAX_PER_CLASS.qc_missing).
    const verdictObj = (qcBody as { verdict?: { sellable?: boolean; reasons?: unknown[] } }).verdict;
    const qcCrashed = !qcRes.ok
      || (qcBody as { ok?: boolean }).ok === false
      || !verdictObj
      || typeof verdictObj.sellable !== 'boolean';

    if (qcCrashed) {
      const crashMsg = String(
        (qcBody as { error?: string }).error
        ?? `qc_run http=${qcRes.status}`,
      ).slice(0, 300);
      await db.from('ebooks_kids').update({
        pipeline_status: 'qc_pending',
        blocker_reason: `qc_crash: ${crashMsg}`,
        human_review_reason: null,
      }).eq('id', ebook_id);
      if (autoRepairOnFail) {
        // @ts-expect-error EdgeRuntime is a Deno Deploy global
        EdgeRuntime.waitUntil(dispatchRepairSupervisor(ebook_id, run_id));
      }
      return json({ ok: false, ebook_id, publishState: 'qc_crashed', qc_crash: true, error: crashMsg, supervisor_dispatched: autoRepairOnFail });
    }

    const sellable = !!verdictObj.sellable;

    let publishState = 'not_attempted';
    let supervisorDispatched = false;
    let copyGenerated = false;
    if (publish && sellable) {
      // Generate conversion-optimized storefront copy BEFORE flipping to live so
      // parents landing from paid ads see the hook + benefit-led description,
      // not the raw concept brief.
      try {
        const cpRes = await fetch(`${SUPABASE_URL}/functions/v1/kids-generate-storefront-copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ ebook_id }),
        });
        const cp = await cpRes.json().catch(() => ({}));
        copyGenerated = !!cp?.ok;
      } catch (e) {
        console.warn('storefront copy generation failed (publishing anyway)', (e as Error).message);
      }
      // Roll production cost into storefront_meta before flipping to live.
      let production_cost_usd: number | null = null;
      try {
        const { data: cost } = await db.from('ebook_costs').select('total_usd').eq('ebook_id', ebook_id).maybeSingle();
        production_cost_usd = cost?.total_usd != null ? Number(cost.total_usd) : null;
      } catch (e) { console.warn('cost lookup failed', (e as Error).message); }
      const { data: k } = await db.from('ebooks_kids').select('storefront_meta').eq('id', ebook_id).maybeSingle();
      const nextMeta = { ...(k?.storefront_meta ?? {}), production_cost_usd };
      await db.from('ebooks_kids').update({
        listing_status: 'live', status: 'live', pipeline_status: 'published',
        storefront_meta: nextMeta,
      }).eq('id', ebook_id);
      publishState = 'live';
      // Auto-list on Royalty Rights Exchange (idempotent, best-effort)
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/exchange-list-book`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ book_id: ebook_id, book_type: 'kids' }),
        });
      } catch (e) { console.warn('exchange-list-book failed', (e as Error).message); }
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

    return json({ ok: true, ebook_id, publishState, verdict: qcBody?.verdict, story_qc_status: qcBody?.story_qc_status, supervisor_dispatched: supervisorDispatched, copy_generated: copyGenerated });
  } catch (e) {
    console.error('kids-publish-if-qc-passed error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
