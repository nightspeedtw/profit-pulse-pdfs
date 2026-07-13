// Diagnostic-only replay of the calibrated story judge across a set of ebook IDs.
// Writes results to qc_scorecard.story_judge_calibration_replay. Never publishes,
// never generates art, never changes listing_status.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runKidsStoryJudge } from '../_shared/kids-story-judge.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ebook_ids) ? body.ebook_ids : [];
    if (ids.length === 0) return json({ ok: false, error: 'ebook_ids[] required' }, 400);

    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const { data: eb } = await db.from('ebooks_kids').select('id, title, subtitle, manuscript_md, story_bible, qc_scorecard').eq('id', id).maybeSingle();
      if (!eb) { results.push({ ebook_id: id, error: 'not_found' }); continue; }
      const manuscript = String(eb.manuscript_md ?? '').trim();
      if (!manuscript) { results.push({ ebook_id: id, title: eb.title, error: 'no_manuscript' }); continue; }
      const sb = (eb.story_bible ?? {}) as { spreads?: Array<{ text?: string }> };
      const pageTexts = Array.isArray(sb.spreads) ? sb.spreads.map((s) => String(s?.text ?? '')) : [];

      try {
        const report = await runKidsStoryJudge({
          title: String(eb.title ?? ''),
          subtitle: (eb.subtitle as string | null) ?? null,
          ageBand: '4-6',
          manuscript_md: manuscript,
          page_texts: pageTexts,
        });

        const before = (eb.qc_scorecard as { repair_log?: { log?: Array<Record<string, unknown>> } } | null)
          ?.repair_log?.log?.filter((l) => l.step === 'story_rewrite_attempt') ?? [];
        const bestBefore = before.length > 0 ? before[before.length - 1] : null;

        const entry = {
          ebook_id: id,
          title: eb.title,
          judge_version: report.judge_version,
          replayed_at: new Date().toISOString(),
          after: {
            passed: report.story_qc_passed,
            age: report.age_appropriateness_score,
            coh: report.story_coherence_score,
            emo: report.emotional_payoff_score,
            rer: report.reread_value_score,
            lang: report.language_level_score,
            buyer: report.parent_buyer_value_score,
            generic_risk: report.generic_story_risk_score,
            subscores: {
              premise_specificity: report.premise_specificity_score,
              story_engine_specificity: report.story_engine_specificity_score,
              visual_hook_specificity: report.visual_hook_specificity_score,
              retitle_resistance: report.retitle_resistance_score,
              trope_dependency: report.trope_dependency_score,
            },
            generic_risk_analysis: report.generic_risk_analysis,
          },
          before_last_attempt: bestBefore ? {
            model: bestBefore.model,
            attempt: bestBefore.attempt,
            scores: bestBefore.scores,
          } : null,
        };

        // Persist diagnostic ONLY — no listing_status / sellable / publish changes.
        const sc = (eb.qc_scorecard ?? {}) as Record<string, unknown>;
        sc.story_judge_calibration_replay = entry;
        await db.from('ebooks_kids').update({ qc_scorecard: sc }).eq('id', id);

        results.push(entry);
      } catch (e) {
        results.push({ ebook_id: id, title: eb.title, error: String((e as Error).message).slice(0, 300) });
      }
    }

    return json({ ok: true, results, note: 'diagnostic only — no publish, no art, no listing_status changed' });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
