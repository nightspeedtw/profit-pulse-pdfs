// Targeted story-gate repair for kids picture books.
//
// Called after the autopilot pipeline hard-stops at `story_gate` (i.e. the
// strict judge rejected the auto-generated manuscript). We rewrite ONLY the
// manuscript layer up to 3 attempts, re-running the calibrated judge each
// time. Age band, category, product intent and one-click settings are
// preserved. No art / no image cost is spent — art only resumes when the
// caller relaunches `autopilot-kids-pipeline` after this returns `passed`.
//
// Guardrails:
// - No threshold is lowered — thresholds come from the shared judge.
// - Story judge cache is cleared for the new manuscript hash so we never
//   soft-pass a previous score.
// - listing_status stays 'draft' and sellable stays false until the caller
//   re-runs the full pipeline and measured QC passes.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runKidsStoryJudge, type StoryReport } from '../_shared/kids-story-judge.ts';
import { computeManuscriptHash } from '../_shared/manuscript-hash.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const MAX_ATTEMPTS = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function blockersFromReport(r: StoryReport): string[] {
  const b: string[] = [];
  if (r.age_appropriateness_score < 90) b.push(`age=${r.age_appropriateness_score}<90`);
  if (r.story_coherence_score < 90) b.push(`coh=${r.story_coherence_score}<90`);
  if (r.emotional_payoff_score < 85) b.push(`emo=${r.emotional_payoff_score}<85`);
  if (r.reread_value_score < 85) b.push(`rer=${r.reread_value_score}<85`);
  if (r.language_level_score < 90) b.push(`lang=${r.language_level_score}<90`);
  if (r.parent_buyer_value_score < 85) b.push(`buyer=${r.parent_buyer_value_score}<85`);
  if (r.generic_story_risk_score > 25) b.push(`generic_risk=${r.generic_story_risk_score}>25`);
  return b;
}

function buildRewritePrompt(
  attempt: number,
  title: string,
  ageBand: string,
  currentManuscript: string,
  report: StoryReport,
): { system: string; user: string } {
  const blockers = blockersFromReport(report);
  const genericDetails = report.generic_risk_analysis?.generic_details ?? [];
  const distinctiveDetails = report.generic_risk_analysis?.distinctive_details ?? [];
  const evidenceLines = (report.evidence ?? []).slice(0, 8).map(e =>
    `- ${e.dimension}: ${e.reason}${e.quote ? ` — "${e.quote}"` : ''} → repair: ${e.repair_action}`
  ).join('\n');

  const dimensionalGuidance: string[] = [];
  if (report.generic_story_risk_score > 25) {
    dimensionalGuidance.push(
      `**Distinctiveness (generic_risk=${report.generic_story_risk_score}, must be <=25)**: Replace the generic tropes (${genericDetails.join('; ') || 'missing-object mystery, generic dance party, teamwork-solves-problem'}) with a specific, weird, memorable STORY ENGINE unique to this book. Keep the distinctive bits (${distinctiveDetails.join('; ') || 'the plink clue, the donkey wearing the fiddle as a hat'}) but make them the SPINE, not a garnish. The title should be un-swappable with any other animal book.`,
    );
  }
  if (report.reread_value_score < 85) {
    dimensionalGuidance.push(
      `**Reread value (rer=${report.reread_value_score}, must be >=85)**: Add ONE chantable refrain that a 4-6-year-old can shout on every re-read (repeat it at least 4 times with escalation). Plant 2 small callback moments that pay off on the final page. Add a final-page joke/reveal that only lands on the second read.`,
    );
  }
  if (report.emotional_payoff_score < 85) {
    dimensionalGuidance.push(
      `**Emotional payoff (emo=${report.emotional_payoff_score}, must be >=85)**: Give the hero a tiny, felt want at page 1 that gets a warmer, more specific answer at the end than "everyone dances." Show, don't tell.`,
    );
  }
  if (report.language_level_score < 90) {
    dimensionalGuidance.push(
      `**Language level (lang=${report.language_level_score}, must be >=90)**: Cap sentences at ~12 words. Prefer punchy verbs. Read-aloud rhythm. No adult words. Kindergarten cadence.`,
    );
  }
  if (report.parent_buyer_value_score < 85) {
    dimensionalGuidance.push(
      `**Parent value (buyer=${report.parent_buyer_value_score}, must be >=85)**: The ending should give a parent a reason to re-buy or gift — a warm implicit takeaway (never preachy) about noticing what makes each friend uniquely wonderful. Do NOT add a moral speech.`,
    );
  }

  const system = `You are an award-winning picture-book author rewriting a manuscript to pass a strict measured story judge.
Reply with the FULL rewritten manuscript in English, markdown, 600-900 words, ${ageBand} read-aloud level.
No preamble, no explanation, no JSON — just the story text.
Never mention the judge, scores, or repair. Never break the fourth wall.
Keep the same title ("${title}") and the same broad category (funny daytime animal-buddy comedy). Do NOT switch to bedtime, moon/star, or tooth/bathroom lanes.`;

  const user = `ATTEMPT ${attempt} of ${MAX_ATTEMPTS}. The previous manuscript failed the story judge on: ${blockers.join(', ')}.

TARGETED REPAIR INSTRUCTIONS:
${dimensionalGuidance.join('\n\n')}

JUDGE EVIDENCE (fix these specifically):
${evidenceLines || '(no per-evidence rows)'}

STRUCTURAL REQUIREMENTS (all mandatory this attempt):
1. One WEIRD, SPECIFIC story engine that could not be swapped into another animal book.
2. A short chantable refrain (4-8 words) repeated at least 4 times with escalating stakes.
3. Two callback moments planted early that pay off on the final page.
4. A final-page joke/reveal that rewards the second read.
5. Sentences <= 12 words; kindergarten vocabulary.
6. Clear page-turn beats every 60-90 words (roughly one per spread across 12 spreads).
7. Warm, non-preachy ending centered on noticing what makes a friend uniquely wonderful.
8. Keep hero and setting recognizable; do NOT invent a new title.

PREVIOUS MANUSCRIPT (rewrite in full — do not paraphrase):
"""
${currentManuscript}
"""

Return ONLY the new manuscript body in markdown. English only.`;

  return { system, user };
}

async function rewriteManuscript(system: string, user: string): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-pro',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`rewrite ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
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
      .select('min_age, max_age, slug').eq('id', ebook.age_group_id).maybeSingle();
    const ageBand = age ? `${age.min_age}-${age.max_age}` : '4-6';

    const originalReport = (ebook.qc_scorecard as Record<string, unknown> | null)?.story_gate as Record<string, unknown> | null;

    // Re-derive the current judge report as our attempt-0 baseline.
    let currentReport: StoryReport = await runKidsStoryJudge({
      title: String(ebook.title ?? ''),
      subtitle: (ebook.subtitle as string | null) ?? null,
      ageBand,
      manuscript_md: String(ebook.manuscript_md ?? ''),
    });
    let currentManuscript = String(ebook.manuscript_md ?? '');

    const attempts: Array<{
      attempt: number;
      scores: Record<string, number>;
      passed: boolean;
      blockers: string[];
      word_count: number;
    }> = [{
      attempt: 0,
      scores: {
        age: currentReport.age_appropriateness_score,
        coh: currentReport.story_coherence_score,
        emo: currentReport.emotional_payoff_score,
        rer: currentReport.reread_value_score,
        lang: currentReport.language_level_score,
        buyer: currentReport.parent_buyer_value_score,
        generic_risk: currentReport.generic_story_risk_score,
      },
      passed: currentReport.story_qc_passed,
      blockers: blockersFromReport(currentReport),
      word_count: currentManuscript.split(/\s+/).filter(Boolean).length,
    }];

    for (let i = 1; i <= MAX_ATTEMPTS && !currentReport.story_qc_passed; i++) {
      const { system, user } = buildRewritePrompt(i, String(ebook.title ?? ''), ageBand, currentManuscript, currentReport);
      let rewritten: string;
      try {
        rewritten = await rewriteManuscript(system, user);
      } catch (e) {
        attempts.push({ attempt: i, scores: {}, passed: false, blockers: [`rewrite_error: ${(e as Error).message.slice(0, 160)}`], word_count: 0 });
        continue;
      }
      if (!rewritten || rewritten.length < 400) {
        attempts.push({ attempt: i, scores: {}, passed: false, blockers: ['rewrite_too_short'], word_count: rewritten.length });
        continue;
      }

      const nextReport = await runKidsStoryJudge({
        title: String(ebook.title ?? ''),
        subtitle: (ebook.subtitle as string | null) ?? null,
        ageBand,
        manuscript_md: rewritten,
      });

      attempts.push({
        attempt: i,
        scores: {
          age: nextReport.age_appropriateness_score,
          coh: nextReport.story_coherence_score,
          emo: nextReport.emotional_payoff_score,
          rer: nextReport.reread_value_score,
          lang: nextReport.language_level_score,
          buyer: nextReport.parent_buyer_value_score,
          generic_risk: nextReport.generic_story_risk_score,
        },
        passed: nextReport.story_qc_passed,
        blockers: blockersFromReport(nextReport),
        word_count: rewritten.split(/\s+/).filter(Boolean).length,
      });

      // Only accept the rewrite if it did not regress overall.
      // We adopt any attempt that reduces the number of failing dimensions
      // OR passes outright, so successful partial progress feeds attempt N+1.
      const prevFails = blockersFromReport(currentReport).length;
      const newFails = blockersFromReport(nextReport).length;
      if (nextReport.story_qc_passed || newFails <= prevFails) {
        currentManuscript = rewritten;
        currentReport = nextReport;
      }
    }

    // Persist the best manuscript + latest scorecard. Clear the stale
    // story_judge_cache so downstream QC always re-scores against the new hash.
    const newHash = await computeManuscriptHash([{ chapter_index: 1, title: String(ebook.title ?? ''), content: currentManuscript }]);
    const existingMeta = (ebook.storefront_meta as Record<string, unknown> | null) ?? {};
    delete (existingMeta as Record<string, unknown>).story_judge_cache;

    const sc = (ebook.qc_scorecard as Record<string, unknown> | null) ?? {};
    sc.story_gate = {
      passed: currentReport.story_qc_passed,
      scores: {
        age: currentReport.age_appropriateness_score,
        coh: currentReport.story_coherence_score,
        emo: currentReport.emotional_payoff_score,
        rer: currentReport.reread_value_score,
        lang: currentReport.language_level_score,
        buyer: currentReport.parent_buyer_value_score,
        generic_risk: currentReport.generic_story_risk_score,
      },
      subscores: {
        premise_specificity: currentReport.premise_specificity_score,
        story_engine_specificity: currentReport.story_engine_specificity_score,
        visual_hook_specificity: currentReport.visual_hook_specificity_score,
        retitle_resistance: currentReport.retitle_resistance_score,
        trope_dependency: currentReport.trope_dependency_score,
      },
      generic_risk_analysis: currentReport.generic_risk_analysis,
      judge_version: currentReport.judge_version,
      computed_at: currentReport.computed_at,
      repair_attempts: attempts,
      manuscript_hash: newHash,
    };

    await db.from('ebooks_kids').update({
      manuscript_md: currentManuscript,
      word_count: currentManuscript.split(/\s+/).filter(Boolean).length,
      storefront_meta: existingMeta,
      qc_scorecard: sc,
      // Never change listing_status here — publish decision belongs to the QC path.
      // On exhaustion, mark as 'retired' so the parent one-click loop rotates
      // to a fresh concept instead of shelving into human_review_required.
      pipeline_status: currentReport.story_qc_passed ? 'illustrating' : 'retired',
      status: currentReport.story_qc_passed ? 'illustrating' : 'needs_revision',
      blocker_reason: currentReport.story_qc_passed ? null : `story_gate_retired_after_${MAX_ATTEMPTS}_attempts: ${blockersFromReport(currentReport).join(', ')}`,
    }).eq('id', ebook_id);

    // Optionally resume the canonical pipeline. Uses force_finish=true so the
    // already-completed generate_idea / generate_manuscript steps are skipped
    // and story_gate is re-run against the repaired manuscript.
    let resumed = false;
    if (currentReport.story_qc_passed && resume_pipeline) {
      // Prefer an existing run_id if the caller passed one; otherwise create a new run row.
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
        // Fire-and-forget.
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
      passed: currentReport.story_qc_passed,
      attempts,
      final_scores: (sc.story_gate as Record<string, unknown>).scores,
      final_blockers: blockersFromReport(currentReport),
      original_scores: (originalReport as Record<string, unknown> | null)?.scores ?? null,
      resumed,
      pipeline_status: currentReport.story_qc_passed ? 'illustrating' : 'human_review_required',
    });
  } catch (e) {
    console.error('kids-repair-story-gate error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
