// Bounded, ONE-SHOT surgical repair for the Barnyard Boogaloo failure mode.
// Only rewrites the last two spreads + refrain of the current manuscript.
// Preserves title, setting, characters, humor lane, and generic-risk win.
// Runs the calibrated story judge once. If it passes, resumes the canonical
// kids pipeline. If it fails, shelves the concept and leaves listing_status=draft.
//
// Guardrails:
// - No thresholds lowered.
// - No art generated here.
// - Never mutates listing_status/sellable to true.
// - Only ONE rewrite attempt (bounded per prompt spec).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runKidsStoryJudge, type StoryReport } from '../_shared/kids-story-judge.ts';
import { computeManuscriptHash } from '../_shared/manuscript-hash.ts';
import { logAiCost, costDb } from '../_shared/cost-log.ts';
import { STORY_GATE } from '../_shared/story-gate-thresholds.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function blockersFromReport(r: StoryReport): string[] {
  const b: string[] = [];
  if (r.age_appropriateness_score < STORY_GATE.age_appropriateness) b.push(`age=${r.age_appropriateness_score}<${STORY_GATE.age_appropriateness}`);
  if (r.story_coherence_score < STORY_GATE.story_coherence) b.push(`coh=${r.story_coherence_score}<${STORY_GATE.story_coherence}`);
  if (r.emotional_payoff_score < STORY_GATE.emotional_payoff) b.push(`emo=${r.emotional_payoff_score}<${STORY_GATE.emotional_payoff}`);
  if (r.reread_value_score < STORY_GATE.reread_value) b.push(`rer=${r.reread_value_score}<${STORY_GATE.reread_value}`);
  if (r.language_level_score < STORY_GATE.language_level) b.push(`lang=${r.language_level_score}<${STORY_GATE.language_level}`);
  if (r.parent_buyer_value_score < STORY_GATE.parent_buyer_value) b.push(`buyer=${r.parent_buyer_value_score}<${STORY_GATE.parent_buyer_value}`);
  if (r.generic_story_risk_score > STORY_GATE.generic_story_risk_max) b.push(`generic_risk=${r.generic_story_risk_score}>${STORY_GATE.generic_story_risk_max}`);
  return b;
}

function buildSurgicalPrompt(title: string, subtitle: string | null, ageBand: string, manuscript: string): { system: string; user: string } {
  const system = `You are an award-winning picture-book author performing a SURGICAL rewrite pass.
Return the FULL rewritten manuscript in English markdown, 600-900 words, ${ageBand} read-aloud level.
No preamble. No JSON. Just the story.
Preserve title ("${title}") and subtitle ("${subtitle ?? ''}"). Keep the farm setting, daytime humor lane, Farmer Fred's fiddle, Boogaloo Bubble / happiness-eating engine, donkey/bull/cow/fiddle comic energy, and existing distinctive premise.`;

  const user = `Rewrite ONLY the following elements of the manuscript below. Leave every other spread as-is (you may lightly polish wording, but do not change plot, characters, or setting for spreads 1-10).

1. THE REFRAIN — replace whatever refrain exists with a chantable 4-beat pattern with escalating volume cues that a 4-6-year-old will shout on rereads. Example rhythm (do NOT copy verbatim, invent your own words in the same shape):
   Whisper it low.
   Hum it slow.
   Stomp it loud.
   Giggle it proud.
Use this new 4-beat refrain at least 4 times across the story (attach it to existing spreads that already had a refrain moment). Keep it under 12 words total per full pass.

2. PLANT A SECOND SMALL CALLBACK EARLY — introduce ONE concrete tiny object or sound in an early spread (a Bessie plink, a loose fiddle-bow ribbon, a barn bucket, a bell, a low bull hum, the donkey wearing the fiddle as a hat). Weave it in so it feels natural, not shoehorned. Keep any callback already present.

3. REWRITE SPREAD 11 AND SPREAD 12 (the final two spreads) so the resolution:
   - pays off BOTH callbacks (the early planted one AND the quiet character's weird small gift)
   - shows each friend's weird small sound/gift mattering
   - ends with the barnyard winning BECAUSE the quiet/weird sounds became useful
   - avoids a generic "everyone dances" or moral-speech ending
   - stays funny, warm, chantable
   - keeps the final page visually rewarding on a SECOND read (a small joke hiding in plain sight)
   - keeps kindergarten cadence: sentences <= 12 words

DO NOT:
- change the title
- switch settings/lanes
- add a moral lecture
- drop the fiddle, bubble, or comic energy
- make it preachy

CURRENT MANUSCRIPT:
"""
${manuscript}
"""

Return ONLY the new manuscript body in markdown. English only.`;

  return { system, user };
}

async function rewriteOnce(system: string, user: string, ebook_id?: string): Promise<string> {
  // top5_source_fix_v1: enforce paid-call ceiling before spending.
  await assertPaidCeiling({ ebook_id, step: 'kids_surgical_story_repair' });
  const model = 'google/gemini-2.5-pro';
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`rewrite ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const usage = j?.usage ?? {};
  logAiCost(costDb(), { ebook_id, step: 'kids_surgical_story_repair', model,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, provider: 'gateway' });
  const text = j?.choices?.[0]?.message?.content ?? '';
  return String(text).replace(/^```(?:markdown|md)?\s*|\s*```$/g, '').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json();
    const ebook_id: string = body.ebook_id;
    const resume_pipeline: boolean = body.resume_pipeline !== false;
    const run_id: string | null = body.run_id ?? null;
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: ebook, error } = await db.from('ebooks_kids').select(
      'id, title, subtitle, manuscript_md, storefront_meta, qc_scorecard, age_group_id'
    ).eq('id', ebook_id).single();
    if (error || !ebook) return json({ ok: false, error: 'ebook not found' }, 404);

    const { data: age } = await db.from('kids_age_groups')
      .select('min_age, max_age').eq('id', ebook.age_group_id).maybeSingle();
    const ageBand = age ? `${age.min_age}-${age.max_age}` : '4-6';

    const beforeReport = await runKidsStoryJudge({
      title: String(ebook.title ?? ''),
      subtitle: (ebook.subtitle as string | null) ?? null,
      ageBand,
      manuscript_md: String(ebook.manuscript_md ?? ''),
    });

    const beforeScores = {
      age: beforeReport.age_appropriateness_score,
      coh: beforeReport.story_coherence_score,
      emo: beforeReport.emotional_payoff_score,
      rer: beforeReport.reread_value_score,
      lang: beforeReport.language_level_score,
      buyer: beforeReport.parent_buyer_value_score,
      generic_risk: beforeReport.generic_story_risk_score,
    };

    // ONE surgical rewrite attempt.
    const { system, user } = buildSurgicalPrompt(
      String(ebook.title ?? ''),
      (ebook.subtitle as string | null) ?? null,
      ageBand,
      String(ebook.manuscript_md ?? ''),
    );

    let rewritten = '';
    try {
      rewritten = await rewriteOnce(system, user, ebook_id);
    } catch (e) {
      return json({ ok: false, error: `surgical_rewrite_failed: ${(e as Error).message.slice(0, 200)}`, before_scores: beforeScores }, 500);
    }
    if (!rewritten || rewritten.length < 400) {
      return json({ ok: false, error: 'rewrite_too_short', before_scores: beforeScores }, 500);
    }

    const afterReport = await runKidsStoryJudge({
      title: String(ebook.title ?? ''),
      subtitle: (ebook.subtitle as string | null) ?? null,
      ageBand,
      manuscript_md: rewritten,
    });

    const afterScores = {
      age: afterReport.age_appropriateness_score,
      coh: afterReport.story_coherence_score,
      emo: afterReport.emotional_payoff_score,
      rer: afterReport.reread_value_score,
      lang: afterReport.language_level_score,
      buyer: afterReport.parent_buyer_value_score,
      generic_risk: afterReport.generic_story_risk_score,
    };

    // Adopt only if same or fewer failing dimensions (no regression).
    const beforeFails = blockersFromReport(beforeReport).length;
    const afterFails = blockersFromReport(afterReport).length;
    const adopt = afterReport.story_qc_passed || afterFails <= beforeFails;

    const finalManuscript = adopt ? rewritten : String(ebook.manuscript_md ?? '');
    const finalReport = adopt ? afterReport : beforeReport;
    const passed = finalReport.story_qc_passed;

    const newHash = await computeManuscriptHash([{ chapter_index: 1, title: String(ebook.title ?? ''), content: finalManuscript }]);
    const existingMeta = (ebook.storefront_meta as Record<string, unknown> | null) ?? {};
    delete (existingMeta as Record<string, unknown>).story_judge_cache;

    if (passed) {
      (existingMeta as Record<string, unknown>).story_judge_cache = {
        manuscript_hash: newHash,
        scores: afterScores,
        judge_version: finalReport.judge_version,
        computed_at: finalReport.computed_at,
      };
    } else {
      (existingMeta as Record<string, unknown>).shelved = {
        reason: 'story_gate_failed_after_surgical_repair',
        blockers: blockersFromReport(finalReport),
        shelved_at: new Date().toISOString(),
      };
    }

    const finalBlockers = blockersFromReport(finalReport);
    const derivedPassed = finalReport.story_qc_passed === true && finalBlockers.length === 0;
    const sc = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
    sc.story_gate = {
      passed: derivedPassed,
      judge_self_verdict: finalReport.story_qc_passed,
      blockers: finalBlockers,
      threshold_version: 'v5.1-2026-07-18-single-source-of-truth',
      scores: {
        age: finalReport.age_appropriateness_score,
        coh: finalReport.story_coherence_score,
        emo: finalReport.emotional_payoff_score,
        rer: finalReport.reread_value_score,
        lang: finalReport.language_level_score,
        buyer: finalReport.parent_buyer_value_score,
        generic_risk: finalReport.generic_story_risk_score,
      },
      surgical_repair: {
        before: beforeScores,
        after: afterScores,
        adopted: adopt,
        passed_after: passed,
      },
      generic_risk_analysis: finalReport.generic_risk_analysis,
      evidence: finalReport.evidence,
      judge_version: finalReport.judge_version,
      computed_at: finalReport.computed_at,
      manuscript_hash: newHash,
    };

    await db.from('ebooks_kids').update({
      manuscript_md: finalManuscript,
      word_count: finalManuscript.split(/\s+/).filter(Boolean).length,
      storefront_meta: existingMeta,
      qc_scorecard: sc,
      // Never make it sellable here — measured QC owns that decision.
      // Never enter an art status here. The canonical pipeline must re-read
      // qc_scorecard.story_gate.passed === true before any cover/interior spend.
      pipeline_status: derivedPassed ? 'writing' : 'human_review_required',
      status: derivedPassed ? 'writing' : 'needs_revision',
      blocker_reason: derivedPassed ? null : `story_gate: ${finalBlockers.join(', ')}`,
    }).eq('id', ebook_id);

    let resumed = false;
    if (derivedPassed && resume_pipeline) {
      let targetRunId = run_id;
      if (!targetRunId) {
        const { data: newRun } = await db.from('autopilot_kids_runs').insert({
          ebook_kids_id: ebook_id,
          status: 'queued',
          current_step: 'story_gate',
          progress_percent: 0,
        }).select('id').single();
        targetRunId = newRun?.id ?? null;
      }
      if (targetRunId) {
        fetch(`${SUPABASE_URL}/functions/v1/autopilot-kids-pipeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ run_id: targetRunId, force_finish: true }),
        }).catch(e => console.error('resume pipeline invoke failed', e));
        resumed = true;
      }
    }

    return json({
      ok: true,
      ebook_id,
      before_scores: beforeScores,
      after_scores: afterScores,
      adopted: adopt,
      passed,
      final_blockers: blockersFromReport(finalReport),
      resumed,
      shelved: !passed,
      manuscript_hash: newHash,
      word_count: finalManuscript.split(/\s+/).filter(Boolean).length,
    });
  } catch (e) {
    console.error('kids-surgical-story-repair error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
