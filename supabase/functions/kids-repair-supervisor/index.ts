// Kids repair supervisor.
//
// Inspects the latest failed step / QC state for an ebook and dispatches to
// the correct existing repair function ONCE. Persists an append-only repair
// log to storefront_meta.repair_supervisor. Never lowers thresholds. Never
// sets sellable/listing_status directly — only kids-publish-if-qc-passed
// can promote to live.
//
// Bounded per-blocker attempts:
//   story_gate: 3, metadata_gate: 2, bible_check: 1, title_treatment: 1,
//   character_identity: 2, pdf_glyph: 1, worker_resource_limit: 2,
//   qc_missing: 1 per subsystem.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_PER_CLASS: Record<string, number> = {
  story_gate: 3,
  metadata_gate: 2,
  bible_check: 1,
  title_treatment: 1,
  character_identity: 3,
  pdf_glyph: 2,
  worker_resource_limit: 2,
  qc_missing: 3,
  cover: 2,
  image_missing: 2,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface RepairEntry {
  attempt: number;
  current_blocker: string;
  blocker_class: string;
  repair_handler: string;
  stage_before: string;
  stage_after: string;
  result: 'repaired' | 'still_blocked' | 'shelved' | 'published' | 'no_op' | 'error';
  scores_before?: Record<string, unknown>;
  scores_after?: Record<string, unknown>;
  detail?: unknown;
  updated_at: string;
}

async function invoke(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
}

async function appendLog(db: ReturnType<typeof createClient>, ebook_id: string, entry: RepairEntry) {
  const { data: e } = await db.from('ebooks_kids').select('storefront_meta').eq('id', ebook_id).single();
  const meta = ((e?.storefront_meta as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const list = Array.isArray((meta.repair_supervisor as { entries?: unknown }[])?.entries)
    ? ((meta.repair_supervisor as { entries: RepairEntry[] }).entries)
    : [];
  const newList = [...list, entry];
  meta.repair_supervisor = { entries: newList, last_entry: entry, updated_at: entry.updated_at };
  await db.from('ebooks_kids').update({ storefront_meta: meta }).eq('id', ebook_id);
}

function countAttempts(meta: Record<string, unknown> | null, klass: string): number {
  const rs = meta?.repair_supervisor as { entries?: RepairEntry[] } | undefined;
  const entries = Array.isArray(rs?.entries) ? rs!.entries : [];
  // Do not count transient handler errors toward the class budget — the model
  // failed to return valid JSON, no real repair attempt was consumed.
  return entries.filter(e => e.blocker_class === klass && e.result !== 'error').length;
}


function detectBlocker(ebook: Record<string, unknown>, latestFailedStep: { step_name?: string; error_message?: string } | null): { klass: string; detail: string } | null {
  const sc = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
  const listing = String(ebook.listing_status ?? 'draft');
  const sellable = Boolean(ebook.sellable);
  if (listing === 'live' && sellable) return null;

  const stepName = latestFailedStep?.step_name;
  const errMsg = String(latestFailedStep?.error_message ?? '');

  // 1. Story gate — direct step failure OR persisted scorecard flag.
  const sg = sc.story_gate as { passed?: boolean; scores?: Record<string, number> } | undefined;
  if (stepName === 'story_gate' || (sg && sg.passed === false)) {
    const scores = sg?.scores ?? {};
    return { klass: 'story_gate', detail: `story_gate: ${JSON.stringify(scores)}` };
  }

  // 2. Metadata gate mismatch.
  if (stepName === 'metadata_gate' || errMsg.includes('METADATA_STORY_MISMATCH')) {
    return { klass: 'metadata_gate', detail: `metadata_gate: ${errMsg.slice(0, 200)}` };
  }

  // 3. Bible mismatch (pipeline auto-wipes; treat as retry trigger).
  if (stepName === 'bible_check' || errMsg.includes('BIBLE_STORY_MISMATCH')) {
    return { klass: 'bible_check', detail: `bible_check: ${errMsg.slice(0, 200)}` };
  }

  // 4. Title treatment.
  if (errMsg.includes('KIDS_TITLE_TREATMENT_INVALID')) {
    return { klass: 'title_treatment', detail: 'title_treatment_invalid' };
  }

  // 5. Vision / character-identity blockers via measured QC.
  const measured = sc.measured as Record<string, unknown> | undefined;
  if (measured) {
    const cc = Number(measured.character_consistency ?? 100);
    const cim = Number(measured.cover_interior_match ?? 100);
    const sbm = Number(measured.style_bible_match ?? 100);
    if (cc < 90 || cim < 90 || sbm < 90 || errMsg.includes('CHARACTER_IDENTITY_BREAK')) {
      return { klass: 'character_identity', detail: `vision: cc=${cc},cim=${cim},sbm=${sbm}` };
    }
  }

  // 6. PDF glyph mangling.
  if (errMsg.includes('PDF_GLYPH_MANGLING') || errMsg.includes('glyph')) {
    return { klass: 'pdf_glyph', detail: 'pdf_glyph_mangling' };
  }

  // 7. Worker resource limit.
  if (errMsg.includes('WORKER_RESOURCE_LIMIT') || errMsg.includes('resource limit')) {
    return { klass: 'worker_resource_limit', detail: 'worker_resource_limit' };
  }

  // 7b. Image missing on interior page(s) — treat as art regression, rebuild via global style fallback.
  const interiors = Array.isArray(ebook.interior_illustrations) ? (ebook.interior_illustrations as Array<Record<string, unknown>>) : [];
  const anyMissing = interiors.some(p => !p?.image_url && !p?.url);
  if (errMsg.includes('IMAGE_MISSING') || (interiors.length > 0 && interiors.length < 12) || (interiors.length >= 12 && anyMissing)) {
    return { klass: 'image_missing', detail: `image_missing: interiors=${interiors.length}, any_missing=${anyMissing}` };
  }



  // 8. QC missing.
  if (errMsg.includes('KIDS_MEASURED_QC_MISSING') || !measured) {
    // Only classify if we're past art generation.
    const hasPdf = Boolean(ebook.pdf_url);
    const hasInteriors = Array.isArray(ebook.interior_illustrations) && (ebook.interior_illustrations as unknown[]).length >= 12;
    if (hasPdf && hasInteriors) {
      return { klass: 'qc_missing', detail: 'measured_qc_missing' };
    }
  }

  // 9. Cover fail catch-all.
  if (stepName === 'generate_cover' && errMsg) {
    return { klass: 'cover', detail: `cover_error: ${errMsg.slice(0, 200)}` };
  }

  // Nothing recognizable => let caller decide (likely shelve).
  return null;
}

async function resumePipeline(run_id: string) {
  return invoke('autopilot-kids-pipeline', { run_id, force_finish: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json();
    const ebook_id: string = body.ebook_id;
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: ebook, error: ebErr } = await db.from('ebooks_kids').select('*').eq('id', ebook_id).single();
    if (ebErr || !ebook) return json({ ok: false, error: 'ebook not found' }, 404);

    // Latest run: prefer caller-supplied, else newest for this ebook.
    let run_id: string | null = body.run_id ?? null;
    if (!run_id) {
      const { data: r } = await db.from('autopilot_kids_runs').select('id').eq('ebook_kids_id', ebook_id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      run_id = r?.id ?? null;
    }

    // Already live?
    if (ebook.listing_status === 'live' && ebook.sellable) {
      return json({ ok: true, result: 'published', already_live: true, ebook_id });
    }

    // Latest failed step for this run.
    let latestFailedStep: { step_name?: string; error_message?: string } | null = null;
    if (run_id) {
      const { data: steps } = await db.from('autopilot_kids_steps')
        .select('step_name, status, error_message, completed_at')
        .eq('run_id', run_id)
        .order('completed_at', { ascending: false })
        .limit(20);
      latestFailedStep = (steps ?? []).find(s => s.status === 'failed') ?? null;
    }

    const meta = (ebook.storefront_meta as Record<string, unknown> | null) ?? {};
    const totalAttempts = ((meta.repair_supervisor as { entries?: RepairEntry[] } | undefined)?.entries?.length) ?? 0;
    if (totalAttempts >= 12) {
      await db.from('ebooks_kids').update({
        listing_status: 'draft',
        sellable: false,
        pipeline_status: 'retired',
        blocker_reason: 'supervisor_budget_exhausted',
        storefront_meta: {
          ...meta,
          shelved: {
            reason: 'supervisor_budget_exhausted',
            total_attempts: totalAttempts,
            shelved_at: new Date().toISOString(),
          },
        },
      }).eq('id', ebook_id);
      return json({ ok: true, result: 'shelved', reason: 'supervisor_budget_exhausted', total_attempts: totalAttempts });
    }

    const blocker = detectBlocker(ebook, latestFailedStep);
    const stage_before = latestFailedStep?.step_name ?? String(ebook.pipeline_status ?? 'unknown');

    if (!blocker) {
      // If we can't recognize a blocker, try resuming the pipeline once (in case
      // it's just paused mid-way). Otherwise shelve.
      if (run_id && ebook.listing_status !== 'live') {
        await resumePipeline(run_id);
        await appendLog(db, ebook_id, {
          attempt: totalAttempts + 1,
          current_blocker: 'unrecognized',
          blocker_class: 'unknown',
          repair_handler: 'autopilot-kids-pipeline (resume)',
          stage_before,
          stage_after: 'resumed',
          result: 'no_op',
          updated_at: new Date().toISOString(),
        });
        return json({ ok: true, result: 'no_op', resumed: true });
      }
      return json({ ok: true, result: 'no_op', reason: 'no recognizable blocker' });
    }

    const klass = blocker.klass;
    const perClass = countAttempts(meta, klass);
    const max = MAX_PER_CLASS[klass] ?? 1;
    if (perClass >= max) {
      // Exhausted for this class — shelve.
      await db.from('ebooks_kids').update({
        listing_status: 'draft',
        sellable: false,
        // Autopilot must never end in human_review_required. Mark 'retired' so
        // the parent one-click loop rotates to a fresh concept and admins see
        // a plain-language reason instead of a manual-review flag.
        pipeline_status: 'retired',
        blocker_reason: `budget_exhausted:${klass}:${blocker.detail}`,
        storefront_meta: {
          ...meta,
          shelved: {
            reason: `budget_exhausted_${klass}`,
            blocker: blocker.detail,
            attempts_in_class: perClass,
            shelved_at: new Date().toISOString(),
          },
        },
      }).eq('id', ebook_id);
      await appendLog(db, ebook_id, {
        attempt: totalAttempts + 1,
        current_blocker: blocker.detail,
        blocker_class: klass,
        repair_handler: 'shelve',
        stage_before,
        stage_after: 'shelved',
        result: 'shelved',
        updated_at: new Date().toISOString(),
      });
      return json({ ok: true, result: 'shelved', blocker_class: klass, blocker: blocker.detail });
    }

    // Dispatch table.
    let handler = 'unknown';
    let repairBody: Record<string, unknown> = { ebook_id };
    let scores_before: Record<string, unknown> | undefined;

    switch (klass) {
      case 'story_gate': {
        const sg = (ebook.qc_scorecard as Record<string, unknown> | null)?.story_gate as { scores?: Record<string, number> } | undefined;
        scores_before = sg?.scores;
        // First story attempt = surgical (targeted refrain/callbacks/spread 11-12).
        // Subsequent = general kids-repair-story-gate (up to 3 internal).
        if (perClass === 0) {
          handler = 'kids-surgical-story-repair';
          repairBody = { ebook_id, run_id, resume_pipeline: true };
        } else {
          handler = 'kids-repair-story-gate';
          repairBody = { ebook_id, run_id, resume_pipeline: true };
        }
        break;
      }
      case 'metadata_gate':
      case 'bible_check':
        // Both are auto-repaired inline by the pipeline. Supervisor just re-runs.
        handler = 'autopilot-kids-pipeline (resume)';
        break;
      case 'title_treatment':
        handler = 'kids-repair-cover';
        repairBody = { ebook_id, title_treatment_only: true };
        break;
      case 'character_identity':
        // Any consistency failure → global style fallback (regenerates cover + interiors
        // in the stable watercolor_soft style, then re-runs multi-stage PDF + QC).
        handler = 'kids-global-style-fallback';
        repairBody = { ebook_id, publish_if_sellable: true };
        break;
      case 'image_missing':
        // Interior page(s) have no image. Rebuild via global style fallback which
        // regenerates all interiors + cover in the stable style.
        handler = 'kids-global-style-fallback';
        repairBody = { ebook_id, publish_if_sellable: true };
        break;
      case 'pdf_glyph':
        handler = 'kids-final-text-repair';
        repairBody = { ebook_id, publish: true };
        break;
      case 'worker_resource_limit':
        handler = 'kids-build-picture-pdf';
        repairBody = { ebook_id, publish: true, stage: 'resume' };
        break;
      case 'qc_missing':
        handler = 'kids-qc-run';
        repairBody = { ebook_id, run_id, use_cached_story_judge_if_hash_matches: true };
        break;
      case 'cover':
        handler = 'kids-repair-cover';
        repairBody = { ebook_id };
        break;
      default:
        handler = 'autopilot-kids-pipeline (resume)';
    }

    let repairResult: unknown = null;
    let handlerOk = false;
    try {
      if (handler === 'autopilot-kids-pipeline (resume)') {
        if (run_id) {
          const r = await resumePipeline(run_id);
          repairResult = { status: r.status };
          handlerOk = r.ok;
        } else {
          repairResult = { error: 'no run_id' };
        }
      } else {
        const r = await invoke(handler, repairBody);
        const t = await r.text();
        try { repairResult = JSON.parse(t); } catch { repairResult = t.slice(0, 400); }
        handlerOk = r.ok;
        // Chain a pipeline resume unless the handler itself already resumes.
        const alreadyResumes = ['kids-surgical-story-repair', 'kids-repair-story-gate', 'kids-global-style-fallback', 'kids-final-text-repair', 'kids-build-picture-pdf'].includes(handler);
        if (handlerOk && !alreadyResumes && run_id) {
          await resumePipeline(run_id);
        }
      }
    } catch (e) {
      repairResult = { error: String((e as Error).message ?? e).slice(0, 300) };
      handlerOk = false;
    }

    // Re-read ebook to capture post-repair state.
    const { data: after } = await db.from('ebooks_kids').select('id, listing_status, sellable, pipeline_status, qc_scorecard').eq('id', ebook_id).single();
    const afterListing = String(after?.listing_status ?? 'draft');
    const afterSellable = Boolean(after?.sellable);
    const afterSg = (after?.qc_scorecard as Record<string, unknown> | null)?.story_gate as { scores?: Record<string, number> } | undefined;
    const scores_after = afterSg?.scores;

    let result: RepairEntry['result'];
    if (afterListing === 'live' && afterSellable) result = 'published';
    else if (!handlerOk) result = 'error';
    else result = 'repaired';

    await appendLog(db, ebook_id, {
      attempt: totalAttempts + 1,
      current_blocker: blocker.detail,
      blocker_class: klass,
      repair_handler: handler,
      stage_before,
      stage_after: String(after?.pipeline_status ?? 'unknown'),
      result,
      scores_before,
      scores_after,
      detail: repairResult,
      updated_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      result,
      blocker_class: klass,
      blocker: blocker.detail,
      handler,
      attempt: totalAttempts + 1,
      total_attempts: totalAttempts + 1,
      after_listing: afterListing,
      after_sellable: afterSellable,
    });
  } catch (e) {
    console.error('kids-repair-supervisor error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
