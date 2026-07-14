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
  text_mapping: 2,
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

async function invokeSupervisorInBackground(body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/kids-repair-supervisor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ...body, async: false, background_parent_source: body.source ?? 'unknown' }),
  });
  await r.text().catch(() => '');
}

async function appendLog(db: ReturnType<typeof createClient>, ebook_id: string, entry: RepairEntry) {
  const { data: e } = await db.from('ebooks_kids').select('storefront_meta, qc_scorecard').eq('id', ebook_id).single();
  const meta = ((e?.storefront_meta as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const scorecard = ((e?.qc_scorecard as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const list = Array.isArray((meta.repair_supervisor as { entries?: unknown }[])?.entries)
    ? ((meta.repair_supervisor as { entries: RepairEntry[] }).entries)
    : [];
  const newList = [...list, entry];
  meta.repair_supervisor = { entries: newList, last_entry: entry, updated_at: entry.updated_at };

  const repairLog = ((scorecard.repair_log ?? {}) as Record<string, unknown>);
  const scorecardSupervisor = ((repairLog.repair_supervisor ?? {}) as { entries?: RepairEntry[] });
  const scorecardEntries = Array.isArray(scorecardSupervisor.entries) ? scorecardSupervisor.entries : [];
  scorecard.repair_log = {
    ...repairLog,
    repair_supervisor: {
      entries: [...scorecardEntries, entry],
      last_entry: entry,
      updated_at: entry.updated_at,
    },
  };

  await db.from('ebooks_kids').update({ storefront_meta: meta, qc_scorecard: scorecard }).eq('id', ebook_id);
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
  const criticalErrors = Array.isArray(sc.critical_errors) ? (sc.critical_errors as unknown[]).map(String) : [];
  const reasons = Array.isArray(sc.reasons) ? (sc.reasons as unknown[]).map(String) : [];

  // If an async PDF rebuild is already mid-chain, never start a new art/style
  // repair from stale QC errors. Just resume the PDF chain.
  const pdfJob = ((sc.repair_log as Record<string, unknown> | undefined)?.pdf_repair_job ?? null) as { next_stage?: string | null; stage?: string; updated_at?: string; error?: string | null } | null;
  const errMsg = String(latestFailedStep?.error_message ?? '');
  const pdfJobError = String(pdfJob?.error ?? '');
  const qcText = [...criticalErrors, ...reasons, String(ebook.human_review_reason ?? ''), String(ebook.blocker_reason ?? ''), errMsg, pdfJobError].join(' | ');
  if (pdfJob?.next_stage) {
    return { klass: 'worker_resource_limit', detail: `pdf_repair_in_progress:${pdfJob.next_stage}` };
  }

  if (/text_mapping_gate|KIDS_TEXT_MAPPING_BROKEN|placeholder captions|fix_manuscript_page_split/i.test(qcText)) {
    return { klass: 'text_mapping', detail: `text_mapping: ${qcText.slice(0, 240)}` };
  }

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
  if (qcText.includes('KIDS_TITLE_TREATMENT_INVALID')) {
    return { klass: 'title_treatment', detail: 'title_treatment_invalid' };
  }

  // 5. Vision / character-identity blockers via measured QC.
  const measured = sc.measured as Record<string, unknown> | undefined;
  if (criticalErrors.some((id) => [
    'VISION_CHARACTER_CONSISTENCY_FAIL',
    'VISION_COVER_INTERIOR_MISMATCH',
    'VISION_STYLE_BIBLE_MISMATCH',
    'CHARACTER_IDENTITY_BREAK',
    'DUPLICATE_ILLUSTRATION_DETECTED',
    'KIDS_MIXED_ART_STYLES',
  ].includes(id)) || /VISION_CHARACTER_CONSISTENCY_FAIL|VISION_COVER_INTERIOR_MISMATCH|VISION_STYLE_BIBLE_MISMATCH|CHARACTER_IDENTITY_BREAK|KIDS_MIXED_ART_STYLES|mixed art styles|off-style/i.test(qcText)) {
    return { klass: 'character_identity', detail: `vision_qc: ${criticalErrors.join(',') || qcText.slice(0, 220)}` };
  }
  if (measured) {
    const cc = Number(measured.character_consistency ?? 100);
    const cim = Number(measured.cover_interior_match ?? 100);
    const sbm = Number(measured.style_bible_match ?? 100);
    if (cc < 90 || cim < 90 || sbm < 90 || qcText.includes('CHARACTER_IDENTITY_BREAK')) {
      return { klass: 'character_identity', detail: `vision: cc=${cc},cim=${cim},sbm=${sbm}` };
    }
  }

  // 5b. Post-PDF story judge failures. These use the same autonomous story
  // repair path as the pre-art story gate, but only after visual blockers have
  // had first chance because art-only repair must not rewrite a passing story.
  const storyReport = sc.story_report as { story_qc_passed?: boolean } | undefined;
  if (storyReport?.story_qc_passed === false || criticalErrors.some((id) => id.startsWith('STORY_')) || /STORY_AGE_APPROPRIATENESS|STORY_COHERENCE|STORY_EMOTIONAL_PAYOFF|STORY_REREAD_VALUE|STORY_LANGUAGE_LEVEL|STORY_PARENT_BUYER_VALUE|STORY_GENERIC_RISK_HIGH/i.test(qcText)) {
    return { klass: 'story_gate', detail: `post_pdf_story_qc: ${criticalErrors.filter((id) => id.startsWith('STORY_')).join(',') || qcText.slice(0, 220)}` };
  }

  // 6. PDF glyph mangling.
  if (qcText.includes('PDF_GLYPH_MANGLING') || /glyph/i.test(qcText)) {
    return { klass: 'pdf_glyph', detail: 'pdf_glyph_mangling' };
  }

  // 7. Worker resource limit.
  if (qcText.includes('WORKER_RESOURCE_LIMIT') || qcText.includes('resource limit')) {
    return { klass: 'worker_resource_limit', detail: 'worker_resource_limit' };
  }

  // 7b. Image missing on interior page(s) — treat as art regression, rebuild via global style fallback.
  const interiors = Array.isArray(ebook.interior_illustrations) ? (ebook.interior_illustrations as Array<Record<string, unknown>>) : [];
  const anyMissing = interiors.some(p => !p?.image_url && !p?.url);
  if (qcText.includes('IMAGE_MISSING') || qcText.includes('INTERIOR_ILLUSTRATIONS_MISSING') || (interiors.length > 0 && interiors.length < 12) || (interiors.length >= 12 && anyMissing)) {
    return { klass: 'image_missing', detail: `image_missing: interiors=${interiors.length}, any_missing=${anyMissing}` };
  }



  // 8. QC missing.
  if (qcText.includes('KIDS_MEASURED_QC_MISSING') || !measured) {
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

    if (body.async === true) {
      // The supervisor can legitimately take longer than callers such as pg_net
      // or the publish/QC worker should wait. Return immediately and let the
      // actual repair run out-of-band.
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      const task = invokeSupervisorInBackground(body).catch((e) => console.error('kids-repair-supervisor async dispatch failed', e));
      if (rt?.waitUntil) rt.waitUntil(task); else task.catch((e) => console.error('kids-repair-supervisor async fallback failed', e));
      return json({ ok: true, accepted: true, ebook_id }, 202);
    }

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
    const allEntries = ((meta.repair_supervisor as { entries?: RepairEntry[] } | undefined)?.entries) ?? [];
    // Free resume entries (see tryFreeResume below) never count toward the
    // repair budget — resuming an interrupted build is not a repair.
    const FREE_CLASSES = new Set(['resume_interior', 'resume_pdf']);
    const totalAttempts = allEntries.filter(e => !FREE_CLASSES.has(e.blocker_class)).length;
    const stage_before = latestFailedStep?.step_name ?? String(ebook.pipeline_status ?? 'unknown');

    // ---- CONVERGENCE GUARD ----
    // If two most-recent QC reports (final_quality_score) for this ebook are
    // within ±2 AND at least 2 non-free repair rounds have already run, the
    // book is thrashing. Retire honestly so the batch can rotate to a fresh
    // concept instead of burning image credits on flat scores.
    if (totalAttempts >= 2) {
      const { data: recentQc } = await db.from('qc_reports')
        .select('final_quality_score, created_at, stage')
        .eq('ebook_id', ebook_id)
        .not('final_quality_score', 'is', null)
        .order('created_at', { ascending: false })
        .limit(2);
      const scores = (recentQc ?? []).map(r => Number(r.final_quality_score)).filter(n => Number.isFinite(n));
      if (scores.length >= 2 && Math.abs(scores[0] - scores[1]) <= 2) {
        await db.from('ebooks_kids').update({
          listing_status: 'draft',
          sellable: false,
          pipeline_status: 'retired',
          blocker_reason: `repair_not_converging: qc ${scores[1]}→${scores[0]} across ${totalAttempts} repair rounds`,
          storefront_meta: {
            ...meta,
            shelved: {
              reason: 'repair_not_converging',
              qc_scores_recent: scores,
              total_attempts: totalAttempts,
              shelved_at: new Date().toISOString(),
            },
          },
        }).eq('id', ebook_id);
        await appendLog(db, ebook_id, {
          attempt: totalAttempts + 1,
          current_blocker: `qc_flatlined:${scores.join(',')}`,
          blocker_class: 'convergence',
          repair_handler: 'retire',
          stage_before, stage_after: 'retired', result: 'shelved',
          detail: { recent_scores: scores },
          updated_at: new Date().toISOString(),
        });
        return json({ ok: true, result: 'shelved', reason: 'repair_not_converging', recent_scores: scores });
      }
    }
    if (totalAttempts >= 12) {
      await db.from('ebooks_kids').update({
        listing_status: 'draft',
        sellable: false,
        pipeline_status: 'retired',
        blocker_reason: 'supervisor_declined: budget_exhausted',
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

    const scorecard = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
    const pdfJob = ((scorecard.repair_log as Record<string, unknown> | undefined)?.pdf_repair_job ?? null) as { next_stage?: string | null; updated_at?: string; error?: string | null; prepared?: boolean } | null;
    if (pdfJob?.next_stage && pdfJob.updated_at) {
      const ageMs = Date.now() - Date.parse(pdfJob.updated_at);
      if (Number.isFinite(ageMs) && ageMs < 8 * 60_000) {
        await appendLog(db, ebook_id, {
          attempt: totalAttempts + 1,
          current_blocker: `pdf_repair_in_progress:${pdfJob.next_stage}`,
          blocker_class: 'worker_resource_limit',
          repair_handler: 'wait_for_active_pdf_chain',
          stage_before,
          stage_after: String(ebook.pipeline_status ?? 'unknown'),
          result: 'no_op',
          detail: { next_stage: pdfJob.next_stage, updated_at: pdfJob.updated_at, age_ms: ageMs },
          updated_at: new Date().toISOString(),
        });
        return json({ ok: true, result: 'no_op', reason: 'pdf_repair_chain_active', next_stage: pdfJob.next_stage });
      }
    }

    // ---- FREE RESUME PATH (always allowed, does not consume repair budget) ----
    // Resuming an interrupted staged build is NOT a repair. If the book is mid-flight
    // (illustrating / pdf_building) and its state is coherent, hand it back to the
    // stage function.
    {
      const status = String(ebook.pipeline_status ?? '');
      const interiors = Array.isArray(ebook.interior_illustrations)
        ? (ebook.interior_illustrations as Array<Record<string, unknown>>) : [];
      const hasPdf = Boolean(ebook.pdf_url);
      const scenePlan = (scorecard.scene_plan as { scenes?: unknown[] } | undefined);
      const plannedCount = Array.isArray(scenePlan?.scenes) ? scenePlan!.scenes!.length : 0;
      // Expected interior count: prefer persisted scene plan; else 28 for 4-6 age
      // band standard; else 16 as safety floor above MIN_TOTAL=12.
      const expected = plannedCount > 0 ? plannedCount : 28;
      const inFlight = status === 'illustrating' || status === 'pdf_building';

      if (!hasPdf && inFlight && interiors.length < expected) {
        const r = await invoke('kids-render-interior', { ebook_id });
        const t = await r.text().catch(() => '');
        await appendLog(db, ebook_id, {
          attempt: totalAttempts + 1,
          current_blocker: `interior_incomplete:${interiors.length}/${expected}`,
          blocker_class: 'resume_interior',
          repair_handler: 'kids-render-interior (free resume)',
          stage_before, stage_after: status,
          result: 'no_op',
          detail: { free_resume: true, dispatch_status: r.status, body: t.slice(0, 240) },
          updated_at: new Date().toISOString(),
        });
        return json({ ok: true, result: 'resumed', kind: 'resume_interior', have: interiors.length, expected, dispatch_status: r.status });
      }

      const pdfJobError = String(pdfJob?.error ?? '');
      const pdfAssemblyNeverStarted = !pdfJob || (!pdfJob.next_stage && !pdfJob.prepared && !pdfJob.error);
      if (!hasPdf && status === 'pdf_building' && interiors.length >= Math.min(expected, 12) && !pdfJobError) {
        const stage = pdfAssemblyNeverStarted ? 'pdf_prepare' : 'resume';
        const r = await invoke('kids-build-picture-pdf', { ebook_id, publish: true, stage });
        const t = await r.text().catch(() => '');
        const ok = r.ok;
        await appendLog(db, ebook_id, {
          attempt: totalAttempts + 1,
          current_blocker: pdfAssemblyNeverStarted ? 'pdf_assembly_never_started' : 'pdf_build_incomplete',
          blocker_class: 'resume_pdf',
          repair_handler: 'kids-build-picture-pdf (free resume)',
          stage_before, stage_after: status,
          result: ok ? 'no_op' : 'error',
          detail: { free_resume: true, stage, dispatch_status: r.status, body: t.slice(0, 240) },
          updated_at: new Date().toISOString(),
        });
        if (!ok) return json({ ok: true, result: 'error', kind: 'resume_pdf_failed', dispatch_status: r.status, body: t.slice(0, 240) });
        return json({ ok: true, result: 'resumed', kind: 'resume_pdf', stage, dispatch_status: r.status });
      }
    }

    const blocker = detectBlocker(ebook, latestFailedStep);

    if (!blocker) {
      // No recognizable blocker AND no free-resume path applied. Count how many
      // consecutive unrecognized no-ops we've already had — after 3, retire so
      // the parent run rotates instead of the book sitting in silent limbo.
      let consecUnknown = 0;
      for (let i = allEntries.length - 1; i >= 0; i--) {
        if (allEntries[i].blocker_class === 'unknown') consecUnknown++;
        else break;
      }
      const currentStatus = String(ebook.pipeline_status ?? 'unknown');
      const isTerminal = ['live', 'published', 'retired', 'exhausted', 'shelved'].includes(currentStatus);
      if (consecUnknown >= 2 || isTerminal) {
        // NO SILENT DEAD-ENDS: retire with a clear reason so the parent
        // one-click loop rotates to a fresh concept.
        await db.from('ebooks_kids').update({
          listing_status: 'draft',
          sellable: false,
          pipeline_status: 'retired',
          blocker_reason: `supervisor_declined: unrecognized_stall in ${currentStatus}`,
          storefront_meta: {
            ...meta,
            shelved: {
              reason: 'supervisor_declined_unrecognized_stall',
              status_at_retire: currentStatus,
              consec_unknown: consecUnknown + 1,
              shelved_at: new Date().toISOString(),
            },
          },
        }).eq('id', ebook_id);
        await appendLog(db, ebook_id, {
          attempt: totalAttempts + 1,
          current_blocker: `unrecognized_stall_in_${currentStatus}`,
          blocker_class: 'unknown',
          repair_handler: 'retire',
          stage_before, stage_after: 'retired', result: 'shelved',
          detail: { consec_unknown: consecUnknown + 1 },
          updated_at: new Date().toISOString(),
        });
        return json({ ok: true, result: 'shelved', reason: 'supervisor_declined_unrecognized_stall' });
      }
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
      case 'character_identity': {
        // Strategy 1 (FIRST attempt): targeted regen of only the pages vision
        // flagged with low character_match. Uses top-scoring pages as pinned
        // references. Cheapest and most surgical repair; only touches broken
        // pages, keeps the ~20 good ones. This is the correct default —
        // rebuilding the whole book was wasting 20+ image credits per attempt.
        //
        // Strategy 2+ (fallback): kids-global-style-fallback rebuilds cover
        // + all interiors in the stable style. Reserved for cases where the
        // targeted regen failed OR the base style itself drifted.
        const sc = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
        const vision = sc.vision_report as { pages?: Array<{ character_match_score?: number }> } | undefined;
        const hasVisionPages = Array.isArray(vision?.pages) && vision!.pages.length > 0;
        if (perClass === 0 && hasVisionPages) {
          handler = 'kids-regenerate-offmodel-pages';
          repairBody = { ebook_id, run_id, publish: true };
        } else {
          handler = 'kids-global-style-fallback';
          repairBody = { ebook_id, publish_if_sellable: true, async: true };
        }
        break;
      }
      case 'image_missing':
        // Interior page(s) have no image. Rebuild via global style fallback which
        // regenerates all interiors + cover in the stable style.
        handler = 'kids-global-style-fallback';
        repairBody = { ebook_id, publish_if_sellable: true, async: true };
        break;
      case 'pdf_glyph':
        handler = 'kids-final-text-repair';
        repairBody = { ebook_id, publish: true };
        break;
      case 'text_mapping':
        handler = 'kids-final-text-repair';
        repairBody = { ebook_id, publish: true, reason: 'text_mapping_gate' };
        break;
      case 'worker_resource_limit':
        handler = 'kids-build-picture-pdf';
        repairBody = { ebook_id, publish: true, stage: 'resume' };
        break;
      case 'qc_missing':
        handler = 'kids-qc-run';
        repairBody = { ebook_id, run_id, use_cached_story_judge_if_hash_matches: true, auto_repair_on_fail: false };
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
        const alreadyResumes = ['kids-surgical-story-repair', 'kids-repair-story-gate', 'kids-global-style-fallback', 'kids-final-text-repair', 'kids-build-picture-pdf', 'kids-regenerate-offmodel-pages'].includes(handler);
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
