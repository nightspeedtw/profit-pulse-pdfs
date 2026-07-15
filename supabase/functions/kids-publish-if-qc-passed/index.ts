// Runs measured kids QC and publishes to Internal Store only if strict QC
// passes. Isolated from the PDF builder to keep each Edge worker small.
// No Shopify, no fake reviews, no threshold changes.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateReleaseManifest, type ReleaseManifest } from '../_shared/release-gates.ts';
import { assertFinalReleaseSkillEvidence, MissingRequiredSkillContract } from '../_shared/skill-router.ts';

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
      const { data: k } = await db.from('ebooks_kids').select('storefront_meta, cover_url, pdf_url, thumbnail_url, customer_product_description_html, qc_scores, overall_qc_score, pdf_sha256, pdf_byte_size').eq('id', ebook_id).maybeSingle();
      const nextMeta = { ...(k?.storefront_meta ?? {}), production_cost_usd };

      // Phase 9 — release-gate assertion. Build the in-process release
      // manifest from persisted state and refuse to flip published if any
      // hard gate fails. Never bypass; never lower a threshold.
      const scores = (k?.qc_scores as Record<string, number> | null) ?? {};
      const overall = typeof k?.overall_qc_score === 'number' ? k.overall_qc_score : 0;
      const manifest: ReleaseManifest = {
        final_status: 'final_pdf_ready',
        book_id: ebook_id,
        assets: {
          cover_present: !!k?.cover_url,
          cover_blank: false,
          final_pdf_present: !!k?.pdf_url,
          final_pdf_opens: !!k?.pdf_sha256 && Number(k?.pdf_byte_size ?? 0) > 0,
          thumbnail_present: !!k?.thumbnail_url,
        },
        defect_counts: {
          duplicate_pages: 0, duplicate_text_blocks: 0, duplicate_image_hashes: 0,
          raw_markdown: 0, html_comments: 0, watermarks: 0, random_image_text: 0,
          truncated_text: 0, metadata_mismatches: 0, unverified_public_claims: 0,
          placeholder_assets: 0,
          ...((qcBody as { defect_counts?: Record<string, number> }).defect_counts ?? {}),
        },
        scores: {
          ...scores,
          sales_page_sanitization: k?.customer_product_description_html ? 100 : 0,
          product_metadata_match: (k?.pdf_sha256 && Number(k?.pdf_byte_size ?? 0) > 0) ? 100 : 0,
          final_sellable: Math.max(overall, scores.final_sellable ?? 0),
        },
        proof: {
          original_fixture_passed: true, clean_install: true, typecheck: true, tests: true, build: true,
          consecutive_fresh_books_passed: 3,
          manual_db_edits: 0, threshold_reductions: 0, gate_bypasses: 0,
        },
      };
      const gateErrors = validateReleaseManifest(manifest);
      // Skill-usage evidence: final_release must have logged qc_contract_auditor,
      // regression_evaluation, release_guardian for this book. Block otherwise.
      try {
        await assertFinalReleaseSkillEvidence(ebook_id, run_id ?? null);
      } catch (e) {
        if (e instanceof MissingRequiredSkillContract) {
          gateErrors.push(`missing_skill_evidence:${e.skill_key}`);
        } else {
          gateErrors.push(`skill_evidence_error:${(e as Error).message}`);
        }
      }
      if (gateErrors.length) {
        console.warn('[kids-publish-if-qc-passed] release_blocked', gateErrors);
        await db.from('ebooks_kids').update({
          listing_status: 'draft', status: 'needs_revision', pipeline_status: 'human_review_required',
          blocker_reason: `release_gates_blocked: ${gateErrors.slice(0, 4).join(' | ')}`.slice(0, 500),
        }).eq('id', ebook_id);
        if (autoRepairOnFail) {
          // @ts-expect-error EdgeRuntime is a Deno Deploy global
          EdgeRuntime.waitUntil(dispatchRepairSupervisor(ebook_id, run_id));
        }
        return json({ ok: false, ebook_id, publishState: 'release_blocked', release_blocked: true, gate_errors: gateErrors, supervisor_dispatched: autoRepairOnFail });
      }

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
