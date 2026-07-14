// Kids one-click build — parent production job.
//
// One admin click = one parent run row that internally cycles:
//   searching_for_concept → writing_story → repairing_story
//   → building_assets → running_qc → published | exhausted
//
// Concept rejections and shelved child ebooks are recorded inside
// metadata.parent_job.child_attempts and do NOT surface as separate red
// FAILED rows. Bounded by concept batches, total ebook attempts, and
// wall-clock runtime. Never lowers thresholds, never force-publishes.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// NOTE: these used to be hardcoded literal UUIDs. kids_age_groups/kids_themes
// rows are created with `gen_random_uuid()` in the seed migration, so a
// literal id baked into source almost never matches this project's actual
// database and causes the very first `ebooks_kids` insert (age_group_id has
// an FK to kids_age_groups) to fail with a foreign-key violation before any
// generation work happens. Resolve defaults by slug at request time instead.
async function defaultAgeGroupId(db: ReturnType<typeof createClient>): Promise<string> {
  const { data, error } = await db.from('kids_age_groups').select('id').eq('slug', '4-6').maybeSingle();
  if (error || !data) throw new Error(`default age group '4-6' not found in kids_age_groups: ${error?.message ?? 'no row'}`);
  return data.id as string;
}
async function defaultThemeId(db: ReturnType<typeof createClient>): Promise<string> {
  const { data, error } = await db.from('kids_themes').select('id').eq('slug', 'humor-fun').maybeSingle();
  if (error || !data) throw new Error(`default theme 'humor-fun' not found in kids_themes: ${error?.message ?? 'no row'}`);
  return data.id as string;
}

const LANE_ROTATION = [
  'food_kitchen_chaos',
  'tiny_detective',
  'animal_buddy_mechanical',
  'neighborhood_micro_adventure',
  'shop_library_museum_logic',
] as const;

type ParentStatus =
  | 'searching_for_concept'
  | 'writing_story'
  | 'repairing_story'
  | 'building_assets'
  | 'running_qc'
  | 'published'
  | 'exhausted'
  | 'failed_system_error';

interface ChildAttempt {
  ebook_id?: string;
  outcome: 'rejected_concept' | 'shelved_story' | 'shelved_art' | 'shelved_qc' | 'published' | 'system_error' | 'skill_learned';
  lane?: string;
  scorecard?: unknown;
  reason?: string;
  title?: string;
  failed_dimensions?: FailedDimension[];
  ts: string;
}

interface FailedDimension {
  dim: string;
  dimension: string;
  score: number;
  threshold: number;
  comparator: '<' | '>';
  critique: string;
}

interface ParentJob {
  target: 'one_live_kids_book';
  status: ParentStatus;
  attempt_count: number;
  concept_batch_count: number;
  story_repair_count: number;
  art_repair_count: number;
  pdf_repair_count: number;
  max_concept_batches: number;
  max_total_ebooks: number;
  max_total_runtime_minutes: number;
  child_attempts: ChildAttempt[];
  published_ebook_id?: string;
  last_blocker?: string;
  final_reason?: string;
  started_at: string;
  updated_at: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function invoke(path: string, body: Record<string, unknown>, timeoutMs = 140_000): Promise<{ ok: boolean; status: number; json?: any; text?: string }> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const t = await r.text();
    let parsed: any = undefined;
    try { parsed = JSON.parse(t); } catch { /* keep text */ }
    return { ok: r.ok, status: r.status, json: parsed, text: t.slice(0, 800) };
  } catch (e) {
    return { ok: false, status: 0, text: `fetch_error: ${String((e as Error)?.message ?? e).slice(0, 300)}` };
  } finally {
    clearTimeout(to);
  }
}

async function saveParent(db: ReturnType<typeof createClient>, runId: string, patch: Partial<ParentJob>, extraRunFields: Record<string, unknown> = {}) {
  const { data: row } = await db.from('autopilot_kids_runs').select('metadata').eq('id', runId).single();
  const meta = (row?.metadata as Record<string, unknown> | null) ?? {};
  const current = (meta.parent_job as ParentJob | undefined) ?? {} as ParentJob;
  const next: ParentJob = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  } as ParentJob;
  meta.parent_job = next;
  await db.from('autopilot_kids_runs').update({ metadata: meta, ...extraRunFields }).eq('id', runId);
  return next;
}

async function appendAttempt(db: ReturnType<typeof createClient>, runId: string, attempt: ChildAttempt) {
  const { data: row } = await db.from('autopilot_kids_runs').select('metadata').eq('id', runId).single();
  const meta = (row?.metadata as Record<string, unknown> | null) ?? {};
  const parent = (meta.parent_job as ParentJob | undefined) ?? {} as ParentJob;
  const list = Array.isArray(parent.child_attempts) ? parent.child_attempts : [];
  parent.child_attempts = [...list, attempt];
  parent.updated_at = new Date().toISOString();
  meta.parent_job = parent;
  await db.from('autopilot_kids_runs').update({ metadata: meta }).eq('id', runId);
}

function friendlyLabel(s: ParentStatus): string {
  switch (s) {
    case 'searching_for_concept': return 'Searching for a strong concept';
    case 'writing_story': return 'Writing story';
    case 'repairing_story': return 'Story repair in progress';
    case 'building_assets': return 'Building cover and illustrations';
    case 'running_qc': return 'Running final QC';
    case 'published': return 'Published';
    case 'exhausted': return 'Stopped: quality budget exhausted';
    case 'failed_system_error': return 'System error: needs admin attention';
  }
}

async function pollUntilResolved(
  db: ReturnType<typeof createClient>,
  ebookId: string,
  runId: string,
  parentRunId: string,
  deadline: number,
): Promise<{ outcome: 'published' | 'shelved_story' | 'shelved_art' | 'shelved_qc' | 'system_error' | 'timeout'; ebook?: Record<string, unknown>; reason?: string; failed_dimensions?: FailedDimension[] }> {
  const pollInterval = 15_000;
  let supervisorDispatchedAt = 0;
  const SUPERVISOR_COOLDOWN_MS = 90_000;

  function classifyShelve(reason: string): 'shelved_story' | 'shelved_art' | 'shelved_qc' {
    if (/pdf|glyph|character|vision|art|cover|style/i.test(reason)) return 'shelved_art';
    if (/qc/i.test(reason)) return 'shelved_qc';
    return 'shelved_story';
  }

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));
    const { data: e } = await db.from('ebooks_kids').select('id, title, listing_status, sellable, pipeline_status, blocker_reason, qc_scorecard, storefront_meta, manuscript_md, story_bible, updated_at').eq('id', ebookId).single();
    if (!e) continue;

    if (e.listing_status === 'live' && e.sellable) {
      return { outcome: 'published', ebook: e };
    }

    // Terminal shelve signal — supervisor already gave up on this child.
    const sm = (e.storefront_meta as Record<string, unknown> | null) ?? {};
    if (sm.shelved) {
      const shelved = sm.shelved as { reason?: string };
      const reason = String(shelved.reason ?? e.blocker_reason ?? 'shelved');
      return { outcome: classifyShelve(reason), ebook: e, reason, failed_dimensions: failedDimensionsFromEbook(e, reason) };
    }

    // Retired = story/art/qc exhausted its own budget. Move to next concept.
    if (e.pipeline_status === 'retired') {
      const reason = String(e.blocker_reason ?? 'retired');
      return { outcome: classifyShelve(reason), ebook: e, reason, failed_dimensions: failedDimensionsFromEbook(e, reason) };
    }

    if (e.pipeline_status === 'human_review_required') {
      const blocker = String(e.blocker_reason ?? '');
      // Story-gate blockers = the reviser exhausted its budget with oscillating
      // scores. Do NOT re-poke the supervisor (it would just shelve). Auto-retire
      // this child and rotate to a fresh concept.
      const isStoryTerminal = /story_gate|needs_concept|oscillat|budget_exhausted:story_gate/i.test(blocker);
      if (isStoryTerminal) {
        await db.from('ebooks_kids').update({
          pipeline_status: 'retired',
          listing_status: 'draft',
          sellable: false,
          blocker_reason: `auto_retired_for_fresh_concept: ${blocker.slice(0, 180)}`,
        }).eq('id', ebookId);
        return { outcome: 'shelved_story', ebook: e, reason: `story_retired: ${blocker.slice(0, 180)}`, failed_dimensions: failedDimensionsFromEbook(e, blocker) };
      }

      const now = Date.now();
      if (now - supervisorDispatchedAt > SUPERVISOR_COOLDOWN_MS) {
        supervisorDispatchedAt = now;
        // Fire-and-forget so we don't block the poll loop on the supervisor.
        invoke('kids-repair-supervisor', { ebook_id: ebookId, run_id: runId }, 145_000)
          .catch(err => console.error('supervisor dispatch error', err));
        await saveParent(db, parentRunId, {
          status: 'building_assets',
          last_blocker: blocker.slice(0, 200),
        });
      }
      continue;
    }

    // Update parent job status label based on current pipeline stage.
    const stage = String(e.pipeline_status ?? '');
    const status: ParentStatus =
      /story|manuscript|writing/i.test(stage) ? 'writing_story'
      : /cover|illustration|interior|art/i.test(stage) ? 'building_assets'
      : /pdf|build/i.test(stage) ? 'building_assets'
      : /qc/i.test(stage) ? 'running_qc'
      : 'writing_story';
    await saveParent(db, parentRunId, { status });
  }
  return { outcome: 'timeout' };
}

async function runLoop(parentRunId: string, ebookId: string, ageBand: string, preferredLanes: string[]) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const start = Date.now();
  const MAX_CONCEPT_BATCHES = 5;
  const MAX_TOTAL_EBOOKS = 5;
  const MAX_RUNTIME_MIN = 45;
  const deadline = start + MAX_RUNTIME_MIN * 60_000;

  await saveParent(db, parentRunId, {
    target: 'one_live_kids_book',
    status: 'searching_for_concept',
    attempt_count: 0,
    concept_batch_count: 0,
    story_repair_count: 0,
    art_repair_count: 0,
    pdf_repair_count: 0,
    max_concept_batches: MAX_CONCEPT_BATCHES,
    max_total_ebooks: MAX_TOTAL_EBOOKS,
    max_total_runtime_minutes: MAX_RUNTIME_MIN,
    child_attempts: [],
    started_at: new Date(start).toISOString(),
    updated_at: new Date(start).toISOString(),
  }, { status: 'running', started_at: new Date(start).toISOString() });

  const triedTitles: string[] = [];
  let ebookAttempts = 0;
  let currentEbookId = ebookId;
  let firstIteration = true;

  const lanes = (preferredLanes.length > 0 ? preferredLanes : [...LANE_ROTATION]) as string[];

  for (let batch = 0; batch < MAX_CONCEPT_BATCHES; batch++) {
    if (Date.now() > deadline) break;
    if (ebookAttempts >= MAX_TOTAL_EBOOKS) break;

    const lane = lanes[batch % lanes.length];
    await saveParent(db, parentRunId, {
      status: 'searching_for_concept',
      concept_batch_count: batch + 1,
      last_blocker: undefined,
    });

    // AUTO SKILL-LEARNING trigger. If the SAME QC dimension has failed in
    // ≥2 recent shelved_story child attempts within this run, invoke the
    // learner to upgrade the playbook BEFORE generating the next concept.
    try {
      const learned = await maybeLearnFromRepeatedFailures(db, parentRunId, ageBand);
      if (learned) {
        await appendAttempt(db, parentRunId, {
          outcome: 'skill_learned',
          lane,
          reason: `learned: ${learned.dimension} → ${learned.skill_key} v${learned.new_version}`,
          ts: new Date().toISOString(),
        } as any);
      }
    } catch (e) {
      console.error('skill_learner_trigger_error', e);
    }


    // Run preflight for this batch.
    const preflight = await invoke('kids-concept-preflight', {
      age_band: ageBand,
      batch_lane: lane,
      avoid_titles: triedTitles,
    }, 140_000);

    const p = preflight.json;
    if (!preflight.ok || !p?.ok) {
      await appendAttempt(db, parentRunId, {
        outcome: 'rejected_concept',
        lane,
        reason: `preflight_call_failed: ${preflight.text?.slice(0, 200)}`,
        ts: new Date().toISOString(),
      });
      continue;
    }

    // Track tried titles from this batch for diversity in next batches.
    const cands = (p.candidates ?? []) as Array<{ concept?: { title?: string } }>;
    for (const c of cands) if (c?.concept?.title) triedTitles.push(c.concept.title);

    if (!p.overall_passed || !p.winner?.concept?.title) {
      // Whole batch rejected — record and try next batch.
      await appendAttempt(db, parentRunId, {
        outcome: 'rejected_concept',
        lane,
        scorecard: cands.map(c => ({ title: c?.concept?.title, scores: (c as any)?.concept_scores, blockers: (c as any)?.blockers })),
        reason: `batch_${batch + 1}_no_pass`,
        ts: new Date().toISOString(),
      });
      continue;
    }

    // Concept passed. Seed the child ebook via kids-fresh-book-start with the pre-locked concept.
    ebookAttempts += 1;
    await saveParent(db, parentRunId, {
      status: 'writing_story',
      attempt_count: ebookAttempts,
    });

    let childEbookId = currentEbookId;
    if (firstIteration) {
      // Reuse the placeholder ebook already created at request time.
      firstIteration = false;
      // Seed the placeholder with the winning concept and kick the canonical pipeline.
      const seed = await invoke('kids-fresh-book-start', {
        age_band: ageBand,
        use_ebook_id: currentEbookId,
        locked_concept: p.winner.concept,
        locked_scores: p.winner.concept_scores,
        skip_preflight: true,
      }, 140_000);
      if (!seed.ok) {
        await appendAttempt(db, parentRunId, {
          outcome: 'system_error',
          lane,
          ebook_id: currentEbookId,
          reason: `fresh_book_start_failed: ${seed.text?.slice(0, 200)}`,
          ts: new Date().toISOString(),
        });
        continue;
      }
      childEbookId = (seed.json?.ebook_id as string) ?? currentEbookId;
    } else {
      // New child ebook + run for subsequent attempts (they will be linked via metadata.parent_run_id).
      const seed = await invoke('kids-fresh-book-start', {
        age_band: ageBand,
        locked_concept: p.winner.concept,
        locked_scores: p.winner.concept_scores,
        skip_preflight: true,
        parent_run_id: parentRunId,
      }, 140_000);
      if (!seed.ok || !seed.json?.ebook_id) {
        await appendAttempt(db, parentRunId, {
          outcome: 'system_error',
          lane,
          reason: `fresh_book_start_failed: ${seed.text?.slice(0, 200)}`,
          ts: new Date().toISOString(),
        });
        continue;
      }
      childEbookId = seed.json.ebook_id as string;
    }

    // Find or create a child run to poll on.
    let childRunId: string | null = null;
    for (let i = 0; i < 6 && !childRunId; i++) {
      await new Promise(r => setTimeout(r, 2_000));
      const { data: r } = await db.from('autopilot_kids_runs')
        .select('id').eq('ebook_kids_id', childEbookId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      childRunId = r?.id ?? null;
    }
    if (!childRunId) childRunId = parentRunId;

    // Poll until published or shelved (bounded by deadline).
    const result = await pollUntilResolved(db, childEbookId, childRunId, parentRunId, deadline);

    if (result.outcome === 'published') {
      await appendAttempt(db, parentRunId, {
        outcome: 'published',
        lane,
        ebook_id: childEbookId,
        ts: new Date().toISOString(),
      });
      await saveParent(db, parentRunId, {
        status: 'published',
        published_ebook_id: childEbookId,
        final_reason: 'published_live',
      }, { status: 'completed', completed_at: new Date().toISOString(), current_step: 'published', current_step_label: 'Published', progress_percent: 100 });
      return;
    }

    if (result.outcome === 'timeout') {
      await saveParent(db, parentRunId, {
        status: 'exhausted',
        final_reason: 'runtime_budget_exhausted',
        last_blocker: 'timeout',
      }, { status: 'failed', completed_at: new Date().toISOString(), blocker_reason: 'runtime_budget_exhausted', current_step: 'exhausted', current_step_label: friendlyLabel('exhausted') });
      return;
    }

    // Shelved of some kind — record attempt and loop to try a new concept batch.
    await appendAttempt(db, parentRunId, {
      outcome: result.outcome,
      lane,
      ebook_id: childEbookId,
      title: String(result.ebook?.title ?? ''),
      reason: result.reason,
      failed_dimensions: result.failed_dimensions ?? failedDimensionsFromEbook(result.ebook ?? {}, String(result.reason ?? '')),
      ts: new Date().toISOString(),
    });
  }

  // Ran out of budget.
  const finalReason = ebookAttempts >= MAX_TOTAL_EBOOKS
    ? 'ebook_attempts_budget_exhausted'
    : 'concept_batches_exhausted';
  await saveParent(db, parentRunId, {
    status: 'exhausted',
    final_reason: finalReason,
  }, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    blocker_reason: finalReason,
    current_step: 'exhausted',
    current_step_label: friendlyLabel('exhausted'),
  });
}

async function resumeParentRun(parentRunId: string, ageBand: string, preferredLanes: string[]) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: run, error } = await db.from('autopilot_kids_runs')
    .select('id, ebook_kids_id, metadata')
    .eq('id', parentRunId)
    .single();
  if (error || !run?.ebook_kids_id) throw new Error(`parent run not found or missing ebook: ${error?.message ?? 'no ebook'}`);

  const meta = (run.metadata as Record<string, unknown> | null) ?? {};
  const parent = (meta.parent_job as ParentJob | undefined) ?? null;
  await saveParent(db, parentRunId, {
    target: 'one_live_kids_book',
    status: 'searching_for_concept',
    attempt_count: parent?.attempt_count ?? 1,
    concept_batch_count: parent?.concept_batch_count ?? 0,
    story_repair_count: parent?.story_repair_count ?? 0,
    art_repair_count: parent?.art_repair_count ?? 0,
    pdf_repair_count: parent?.pdf_repair_count ?? 0,
    max_concept_batches: parent?.max_concept_batches ?? 5,
    max_total_ebooks: parent?.max_total_ebooks ?? 5,
    max_total_runtime_minutes: parent?.max_total_runtime_minutes ?? 45,
    child_attempts: parent?.child_attempts ?? [],
    started_at: parent?.started_at ?? new Date().toISOString(),
  }, { status: 'running', completed_at: null, blocker_reason: null, current_step: 'parent_job', current_step_label: friendlyLabel('searching_for_concept') });

  await runLoop(parentRunId, run.ebook_kids_id as string, ageBand, preferredLanes);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const ageBand: string = body.age_band ?? '4-6';
    const ageGroupId: string = body.age_group_id ?? await defaultAgeGroupId(db);
    const themeIds: string[] = (Array.isArray(body.theme_ids) && body.theme_ids.length > 0)
      ? body.theme_ids
      : [await defaultThemeId(db)];
    const preferredLanes: string[] = Array.isArray(body.preferred_lanes) ? body.preferred_lanes : [];

    if (body.resume_parent_run_id) {
      const parentRunId = String(body.resume_parent_run_id);
      const task = resumeParentRun(parentRunId, ageBand, preferredLanes);
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(task); else task.catch(e => console.error('resume parent loop bg', e));
      return json({ ok: true, resumed_parent_run_id: parentRunId, age_band: ageBand }, 202);
    }

    // Create placeholder ebook + parent run atomically.
    const { data: ebook, error: eErr } = await db.from('ebooks_kids').insert({
      title: 'Kids book (parent job in progress)',
      subtitle: '',
      description: '',
      age_group_id: ageGroupId,
      theme_ids: themeIds,
      status: 'concept_preflight',
      listing_status: 'draft',
      pipeline_status: 'concept_preflight',
      sellable: false,
      locked: false,
      price_cents: 799,
    }).select('id').single();
    if (eErr || !ebook) throw new Error(`create ebook failed: ${eErr?.message}`);

    const { data: run, error: rErr } = await db.from('autopilot_kids_runs').insert({
      ebook_kids_id: ebook.id,
      status: 'queued',
      current_step: 'parent_job',
      current_step_label: friendlyLabel('searching_for_concept'),
      progress_percent: 0,
      metadata: {
        parent_job: {
          target: 'one_live_kids_book',
          status: 'searching_for_concept',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    }).select('id').single();
    if (rErr || !run) throw new Error(`create run failed: ${rErr?.message}`);

    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    const task = runLoop(run.id, ebook.id, ageBand, preferredLanes);
    if (rt?.waitUntil) rt.waitUntil(task); else task.catch(e => console.error('parent loop bg', e));

    return json({ ok: true, parent_run_id: run.id, ebook_id: ebook.id, age_band: ageBand });
  } catch (e) {
    console.error('kids-one-click-build error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

// ─── Auto skill-learning helpers ─────────────────────────────────────────────
// Parses failing-dimension tokens (e.g. "buyer=80<85") out of recent
// shelved_story child attempts recorded in metadata.parent_job.child_attempts.
// If the SAME dimension has failed in ≥2 attempts since the last learning
// event for that dimension, invoke kids-skill-learner and return the result.

const DIM_TOKEN_MAP: Record<string, string> = {
  buyer: 'parent_buyer_value',
  emo: 'emotional_payoff',
  rer: 'reread_value',
  lang: 'language_level',
  age: 'age_appropriateness',
  coh: 'story_coherence',
  generic_risk: 'generic_risk',
};

const DIM_SHORT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(DIM_TOKEN_MAP).map(([short, dimension]) => [dimension, short]),
);

const DIM_THRESHOLDS: Record<string, { threshold: number; comparator: '<' | '>' }> = {
  parent_buyer_value: { threshold: 85, comparator: '<' },
  emotional_payoff: { threshold: 85, comparator: '<' },
  reread_value: { threshold: 85, comparator: '<' },
  language_level: { threshold: 90, comparator: '<' },
  age_appropriateness: { threshold: 90, comparator: '<' },
  story_coherence: { threshold: 90, comparator: '<' },
  generic_risk: { threshold: 25, comparator: '>' },
};

function critiqueForDimension(storyGate: Record<string, unknown>, dimension: string): string {
  const evidence = Array.isArray(storyGate.evidence) ? storyGate.evidence as Array<Record<string, unknown>> : [];
  const needles: Record<string, string[]> = {
    parent_buyer_value: ['parent', 'buyer'],
    emotional_payoff: ['emotion', 'payoff'],
    reread_value: ['reread', 're-read', 're_read'],
    language_level: ['language', 'vocab'],
    age_appropriateness: ['age'],
    story_coherence: ['coherence', 'continuity', 'structure'],
    generic_risk: ['generic', 'distinctive', 'risk'],
  };
  const keys = needles[dimension] ?? [dimension];
  const rows = evidence.filter((e) => keys.some(k => String(e.dimension ?? '').toLowerCase().includes(k)));
  const selected = rows.length ? rows : evidence.slice(0, 3);
  return selected.slice(0, 4).map((e) => {
    const reason = String(e.reason ?? '').trim();
    const quote = String(e.quote ?? '').trim();
    const repair = String(e.repair_action ?? '').trim();
    return [reason, quote ? `"${quote}"` : '', repair ? `repair: ${repair}` : ''].filter(Boolean).join(' — ');
  }).join('\n').slice(0, 1200);
}

function failedDimensionsFromStoryGate(storyGate: Record<string, unknown> | null | undefined, fallbackReason = ''): FailedDimension[] {
  const scores = (storyGate?.scores ?? {}) as Record<string, unknown>;
  const out: FailedDimension[] = [];
  const scoreByDimension: Record<string, unknown> = {
    age_appropriateness: scores.age,
    story_coherence: scores.coh,
    emotional_payoff: scores.emo,
    reread_value: scores.rer,
    language_level: scores.lang,
    parent_buyer_value: scores.buyer,
    generic_risk: scores.generic_risk,
  };
  for (const [dimension, raw] of Object.entries(scoreByDimension)) {
    const score = Number(raw);
    const gate = DIM_THRESHOLDS[dimension];
    if (!Number.isFinite(score) || !gate) continue;
    const failed = gate.comparator === '<' ? score < gate.threshold : score > gate.threshold;
    if (!failed) continue;
    out.push({
      dim: DIM_SHORT_MAP[dimension] ?? dimension,
      dimension,
      score,
      threshold: gate.threshold,
      comparator: gate.comparator,
      critique: critiqueForDimension(storyGate ?? {}, dimension) || fallbackReason.slice(0, 800),
    });
  }
  if (out.length > 0) return out;
  return extractFailingDimensions(fallbackReason).map(d => {
    const gate = DIM_THRESHOLDS[d.dimension] ?? { threshold: 85, comparator: '<' as const };
    return {
      dim: DIM_SHORT_MAP[d.dimension] ?? d.dimension,
      dimension: d.dimension,
      score: d.score,
      threshold: gate.threshold,
      comparator: gate.comparator,
      critique: fallbackReason.slice(0, 800),
    };
  });
}

function failedDimensionsFromEbook(ebook: Record<string, unknown>, fallbackReason = ''): FailedDimension[] {
  const sc = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
  const storyGate = sc.story_gate as Record<string, unknown> | undefined;
  return failedDimensionsFromStoryGate(storyGate, fallbackReason);
}

function structureEvidenceFromEbook(ebook: Record<string, unknown>): string {
  const sc = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
  const storyGate = (sc.story_gate ?? {}) as Record<string, unknown>;
  const manuscript = String(ebook.manuscript_md ?? '');
  const refrainLines = manuscript.split('\n')
    .map(s => s.trim())
    .filter(s => s.length >= 4 && s.length <= 80 && (/!|\*|\b(again|try|go|stop|push|tap|click|flap|rumble|squeak|chant)\b/i.test(s)))
    .slice(0, 10);
  const attempts = Array.isArray(storyGate.repair_attempts) ? storyGate.repair_attempts : [];
  const generic = storyGate.generic_risk_analysis ? JSON.stringify(storyGate.generic_risk_analysis).slice(0, 500) : '';
  const excerpt = manuscript.replace(/\s+/g, ' ').slice(0, 1200);
  return [
    refrainLines.length ? `Candidate refrain/action lines:\n${refrainLines.map(s => `- ${s}`).join('\n')}` : '',
    attempts.length ? `Repair score path: ${JSON.stringify(attempts).slice(0, 700)}` : '',
    generic ? `Generic/story-engine analysis: ${generic}` : '',
    excerpt ? `Manuscript opening/structure excerpt: ${excerpt}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 2500);
}

function extractFailingDimensions(reason: string): Array<{ dimension: string; score: number }> {
  const out: Array<{ dimension: string; score: number }> = [];
  const re = /(buyer|emo|rer|lang|age|coh|generic_risk)=(\d+)(?:<\d+|>\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reason)) !== null) {
    const dim = DIM_TOKEN_MAP[m[1]];
    if (dim) out.push({ dimension: dim, score: Number(m[2]) });
  }
  return out;
}

async function maybeLearnFromRepeatedFailures(
  db: ReturnType<typeof createClient>, parentRunId: string, ageBand: string,
): Promise<{ dimension: string; skill_key: string; new_version: number } | null> {
  const { data: run } = await db.from('autopilot_kids_runs')
    .select('metadata').eq('id', parentRunId).maybeSingle();
  const meta = ((run?.metadata ?? {}) as Record<string, unknown>);
  const parentJob = ((meta.parent_job ?? {}) as Record<string, unknown>);
  const attempts = (Array.isArray(parentJob.child_attempts) ? parentJob.child_attempts : []) as Array<Record<string, unknown>>;
  const alreadyLearned = new Set(attempts
    .filter(a => a.outcome === 'skill_learned' && typeof a.reason === 'string')
    .map(a => String(a.reason).split(':')[1]?.trim().split(' ')[0] ?? '')
    .filter(Boolean));

  const dimCounts = new Map<string, Array<{ title: string; score: number; critique: string; manuscript_structure?: string }>>();
  for (const a of attempts) {
    if (a.outcome !== 'shelved_story') continue;
    const reason = String(a.reason ?? '');
    const explicit = Array.isArray(a.failed_dimensions) ? a.failed_dimensions as Array<Record<string, unknown>> : [];
    const dims = explicit.length
      ? explicit.map(d => ({
          dimension: String(d.dimension ?? DIM_TOKEN_MAP[String(d.dim ?? '')] ?? ''),
          score: Number(d.score ?? 0),
          critique: String(d.critique ?? reason),
        })).filter(d => d.dimension && Number.isFinite(d.score))
      : extractFailingDimensions(reason).map(d => ({ ...d, critique: reason }));
    for (const d of dims) {
      if (alreadyLearned.has(d.dimension)) continue;
      const list = dimCounts.get(d.dimension) ?? [];
      list.push({ title: String(a.title ?? a.ebook_id ?? ''), score: d.score, critique: d.critique.slice(0, 1200) });
      dimCounts.set(d.dimension, list);
    }
  }

  // Cross-run memory: if a gate wall persists across runs, learn from recent
  // retired/shelved kids books too. This is deliberately read-only and bounded.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentShelved } = await db.from('ebooks_kids')
    .select('id, title, pipeline_status, blocker_reason, qc_scorecard, manuscript_md, story_bible, updated_at')
    .in('pipeline_status', ['retired', 'human_review_required'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(30);
  for (const e of (recentShelved ?? []) as Array<Record<string, unknown>>) {
    const reason = String(e.blocker_reason ?? '');
    if (!/story_gate|rer=|coh=|emo=|buyer=|generic_risk|age=|lang=/i.test(reason + JSON.stringify((e.qc_scorecard as Record<string, unknown> | null)?.story_gate ?? {}))) continue;
    const dims = failedDimensionsFromEbook(e, reason);
    for (const d of dims) {
      if (alreadyLearned.has(d.dimension)) continue;
      const list = dimCounts.get(d.dimension) ?? [];
      const title = String(e.title ?? e.id ?? 'untitled');
      if (list.some(item => item.title === title)) continue;
      list.push({
        title,
        score: d.score,
        critique: d.critique || reason.slice(0, 1200),
        manuscript_structure: structureEvidenceFromEbook(e),
      });
      dimCounts.set(d.dimension, list);
    }
  }

  let bestDim: string | null = null;
  let bestList: Array<{ title: string; score: number; critique: string }> = [];
  for (const [dim, list] of dimCounts) {
    if (list.length >= 2 && list.length > bestList.length) {
      bestDim = dim; bestList = list;
    }
  }
  if (!bestDim) return null;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/kids-skill-learner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      dimension: bestDim,
      age_band: ageBand,
      recent_failures: bestList.map(f => ({ title: f.title, score: f.score, judge_critique: f.critique, manuscript_structure: f.manuscript_structure })),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok) {
    console.error('skill_learner_call_failed', res.status, j);
    return null;
  }
  return { dimension: bestDim, skill_key: String(j.skill_key), new_version: Number(j.new_version) };
}
