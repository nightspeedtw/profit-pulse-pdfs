// Fresh kids book starter with concept preflight.
//
// Creates the ebook + run rows, kicks off the concept preflight + pipeline
// asynchronously via EdgeRuntime.waitUntil so the caller gets ebook_id/run_id
// immediately and can poll DB for progress. All heavy Gemini work happens in
// the background task.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const AGE_4_6 = 'fb6aad48-5bb3-4547-8700-35f6e160e70a';
const THEME_HUMOR = '08c870b2-d7c4-4fd6-8c31-d0b76d8d997a';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function runBackground(ebookId: string, runId: string, ageBand: string) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    // 1. concept preflight (calls sibling function)
    const preflightRes = await fetch(`${SUPABASE_URL}/functions/v1/kids-concept-preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ age_band: ageBand }),
    });
    const preflight = await preflightRes.json();
    if (!preflight?.ok || !preflight?.winner?.concept?.title) {
      await db.from('ebooks_kids').update({
        pipeline_status: 'human_review_required',
        status: 'needs_revision',
        blocker_reason: `concept_preflight_failed: ${JSON.stringify(preflight?.error ?? 'no winner').slice(0, 400)}`,
        storefront_meta: { concept_preflight: preflight },
      }).eq('id', ebookId);
      await db.from('autopilot_kids_runs').update({
        status: 'failed',
        blocker_reason: 'concept_preflight_failed',
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
      return;
    }

    const w = preflight.winner;
    const c = w.concept;

    // 2. Seed ebook with concept so pipeline's generate_idea step is skipped.
    const conceptDescription = `${c.core_story_engine ?? c.story_engine ?? ''} Hero: ${c.hero}. Setting: ${c.setting}. Central problem: ${c.central_problem ?? ''}. Story rule: ${c.story_rule ?? ''}. Refrain: "${c.refrain}". Callbacks: ${c.callback_1}; ${c.callback_2}. Final payoff: ${c.final_page_payoff}. Why reread: ${c.why_child_will_reread ?? c.reread_hook ?? ''}. Buyer hook: ${c.parent_buyer_hook}. Why parent buys: ${c.why_parent_will_buy ?? ''}.`;

    await db.from('ebooks_kids').update({
      title: c.title,
      subtitle: c.subtitle,
      description: conceptDescription,
      storefront_title: c.title,
      storefront_subtitle: c.subtitle,
      storefront_meta: {
        main_character: c.hero,
        concept_brief: c,
        locked_concept: c,
        concept_preflight: {
          winner_concept: c,
          winner_scores: w.concept_scores ?? w.scores,
          winner_decision: w.decision,
          winner_passed: w.passed,
          winner_blockers: w.blockers,
          winner_banned_lane_hits: w.banned_lane_hits,
          candidates: preflight.candidates,
          candidates_scored: preflight.candidates?.length ?? 0,
          overall_passed: preflight.overall_passed,
          thresholds: preflight.thresholds,
        },
      },
      status: preflight.overall_passed ? 'writing' : 'needs_revision',
      pipeline_status: preflight.overall_passed ? 'story_generation' : 'human_review_required',
    }).eq('id', ebookId);

    if (!preflight.overall_passed) {
      // Don't proceed to art or manuscript — shelve as needs_concept.
      await db.from('autopilot_kids_runs').update({
        status: 'failed',
        current_step: 'needs_concept',
        current_step_label: 'Concept preflight did not pass',
        blocker_reason: `needs_concept: ${(w.blockers ?? []).join(', ').slice(0, 400)}`,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
      return;
    }


    // 3. Kick off the canonical kids pipeline. generate_idea will short-circuit
    //    because title+description are already populated.
    fetch(`${SUPABASE_URL}/functions/v1/autopilot-kids-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ run_id: runId }),
    }).catch(e => console.error('pipeline invoke failed', e));
  } catch (e) {
    console.error('background error', e);
    await db.from('ebooks_kids').update({
      pipeline_status: 'human_review_required',
      status: 'needs_revision',
      blocker_reason: `fresh_start_bg_error: ${String((e as Error)?.message ?? e).slice(0, 400)}`,
    }).eq('id', ebookId);
    await db.from('autopilot_kids_runs').update({
      status: 'failed',
      blocker_reason: `fresh_start_bg_error`,
      completed_at: new Date().toISOString(),
    }).eq('id', runId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const ageBand: string = body.age_band ?? '4-6';
    const ageGroupId: string = body.age_group_id ?? AGE_4_6;
    const themeIds: string[] = body.theme_ids ?? [THEME_HUMOR];

    // Create placeholder ebook row.
    const { data: ebook, error: ebookErr } = await db.from('ebooks_kids').insert({
      title: 'Fresh kids book (preflight in progress)',
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
    if (ebookErr || !ebook) throw new Error(`create ebook failed: ${ebookErr?.message}`);

    const { data: run, error: runErr } = await db.from('autopilot_kids_runs').insert({
      ebook_kids_id: ebook.id,
      status: 'queued',
      current_step: 'concept_preflight',
      current_step_label: 'Concept preflight',
      progress_percent: 0,
    }).select('id').single();
    if (runErr || !run) throw new Error(`create run failed: ${runErr?.message}`);

    // Fire the background task (Deno EdgeRuntime.waitUntil pattern).
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) {
      rt.waitUntil(runBackground(ebook.id, run.id, ageBand));
    } else {
      // Best-effort fire-and-forget.
      runBackground(ebook.id, run.id, ageBand).catch(e => console.error('bg', e));
    }

    return json({ ok: true, ebook_id: ebook.id, run_id: run.id, age_band: ageBand });
  } catch (e) {
    console.error('kids-fresh-book-start error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
