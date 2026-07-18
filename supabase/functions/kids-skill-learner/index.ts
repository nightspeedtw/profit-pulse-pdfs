// kids-skill-learner — auto skill-learning for the kids picture-book pipeline.
//
// POST { dimension: string, recent_failures: [{title, score, judge_critique}], age_band? }
//
// When the SAME QC dimension keeps failing across multiple child books in a
// run, the parent orchestrator invokes this function. It asks the LLM to
// rewrite the playbook section targeting that dimension, informed by the
// specific critiques from the failing books. The new content is UPSERTED as a
// new version into public.pipeline_skills so all downstream prompts pick it
// up on the next generation.
//
// The bar is never lowered — the goal is a MORE SPECIFIC skill section, not
// a weaker gate.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Map dimension → skill_key we improve.
const DIMENSION_TO_SKILL_KEY: Record<string, string> = {
  rer: 'playbook_reread_value',
  reread: 'playbook_reread_value',
  parent_buyer_value: 'playbook_parent_buyer_value',
  buyer: 'playbook_parent_buyer_value',
  emotional_payoff: 'playbook_emotional_payoff',
  emo: 'playbook_emotional_payoff',
  reread_value: 'playbook_reread_value',
  language_level: 'craft_rules',
  lang: 'craft_rules',
  age_appropriateness: 'anti_preachy',
  age: 'anti_preachy',
  story_coherence: 'craft_rules',
  coh: 'craft_rules',
  generic_risk: 'craft_rules',
};

const DIMENSION_ALIASES: Record<string, string> = {
  rer: 'reread_value',
  reread: 'reread_value',
  reread_value: 'reread_value',
  coh: 'story_coherence',
  coherence: 'story_coherence',
  story_coherence: 'story_coherence',
  emo: 'emotional_payoff',
  emotional: 'emotional_payoff',
  emotional_payoff: 'emotional_payoff',
  buyer: 'parent_buyer_value',
  parent_buyer_value: 'parent_buyer_value',
  lang: 'language_level',
  language: 'language_level',
  language_level: 'language_level',
  age: 'age_appropriateness',
  age_appropriateness: 'age_appropriateness',
  generic: 'generic_risk',
  generic_risk: 'generic_risk',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // FROZEN (2026-07-18, right-first-time architecture): the auto-revision loop
  // ran 119+ versions across playbook_reread_value and craft_rules without
  // moving the pass rate. Owner-approved freeze: pinned seed versions are
  // injected into the writer prompt (see loadStoryCraftBlock's freeze list).
  // Prior versions remain in pipeline_skills for future analysis but no new
  // ones are minted. This endpoint is a no-op.
  return json({
    ok: true, frozen: true,
    reason: 'skill_learner_frozen_right_first_time_2026_07_18',
    doc: 'Pinned seed versions of playbook_* / craft_rules / anti_preachy are now the canonical craft block.',
  });
});

// Legacy handler retained below for reference / manual replay only. Never invoked.
async function _legacyHandler(req: Request) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json();
    const requestedDimension: string = String(body.dimension ?? '').trim();
    const dimension: string = DIMENSION_ALIASES[requestedDimension] ?? requestedDimension;
    const ageBand: string = String(body.age_band ?? '4-6');
    const failures: Array<{ title?: string; score?: number; judge_critique?: string; manuscript_structure?: string }> =
      Array.isArray(body.recent_failures) ? body.recent_failures : [];
    if (!dimension) return json({ ok: false, error: 'dimension required' }, 400);

    const skillKey = DIMENSION_TO_SKILL_KEY[dimension] ?? DIMENSION_TO_SKILL_KEY[requestedDimension] ?? `playbook_${dimension}`;

    // Fetch current latest version of this skill_key.
    const { data: existing } = await db.from('pipeline_skills')
      .select('skill_key, version, content_md, sort_index, age_band, target_dimension')
      .eq('skill_key', skillKey)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentVersion = existing?.version ?? 0;
    const currentContent = existing?.content_md ?? '(no prior version)';

    const failuresBlock = failures.length
      ? failures.slice(0, 8).map((f, i) =>
          `Failure ${i + 1}: "${f.title ?? 'untitled'}" scored ${f.score ?? '?'}/100 on ${dimension}.\nJudge critique: ${(f.judge_critique ?? '(no critique)').slice(0, 1000)}\nManuscript/refrain/structure evidence: ${(f.manuscript_structure ?? '(not supplied)').slice(0, 1800)}`
        ).join('\n\n')
      : '(no failure evidence supplied)';

    const system = `You are a senior children's-publishing craft researcher specializing in commercial picture books for ages ${ageBand}. Your job is to REWRITE a playbook section that keeps failing to lift the QC dimension "${dimension}".

CONSTRAINTS:
- Never lower the bar. Never suggest hitting a lower score.
- Draw on established best practice from published picture books, editorial/agent guidance, Nielsen buyer research, award-committee criteria (Caldecott, Kate Greenaway), and read-aloud research.
- Be MORE specific than the current version. Add concrete rules, concrete examples, and concrete anti-patterns.
- Keep it directly usable as a prompt fragment (markdown, no meta-commentary about "I improved…").
- If the dimension is reread_value, be prescriptive: require a call-and-response refrain with a kid action, a cumulative three-tries pattern with escalating size/sound words, and a hidden-object/callback thread that illustration briefs can carry across spreads.
- Preserve any references to rule ids used elsewhere (e.g. hero_solves_it_themselves, final_spread_warm_payoff, chantable_or_ritual_repetition).
- Length target: 900–1600 characters. Denser is better; do not pad.

Return ONLY the new playbook body. No preamble.`;

    const user = `DIMENSION TO LIFT: ${dimension}
REQUESTED TOKEN: ${requestedDimension}
AGE BAND: ${ageBand}

CURRENT PLAYBOOK (version ${currentVersion}) — the writer is following this and still failing:
"""
${currentContent}
"""

REPEATED FAILURES from recent books using the current playbook:
${failuresBlock}

Rewrite the playbook so a manuscript following it would score ≥85 on ${dimension}. Focus on what the failures suggest is missing.`;

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
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 300);
      return json({ ok: false, error: `learner_llm_${res.status}: ${txt}` }, 502);
    }
    const j = await res.json();
    const newContent = String(j?.choices?.[0]?.message?.content ?? '')
      .replace(/^```(?:markdown|md)?\s*|\s*```$/g, '').trim();
    if (!newContent || newContent.length < 300) {
      return json({ ok: false, error: 'learner_output_too_short', got_len: newContent.length }, 502);
    }

    const nextVersion = currentVersion + 1;
    const { error: insErr } = await db.from('pipeline_skills').insert({
      skill_key: skillKey,
      version: nextVersion,
      content_md: newContent,
      source: 'learned',
      target_dimension: dimension,
      age_band: existing?.age_band ?? null,
      sort_index: existing?.sort_index ?? 100,
      metadata: {
        learned_from_failures: failures.map(f => ({ title: f.title, score: f.score })),
        prior_version: currentVersion,
      },
    });
    if (insErr) return json({ ok: false, error: `skill_upsert_failed: ${insErr.message}` }, 500);

    return json({
      ok: true,
      requested_dimension: requestedDimension,
      dimension,
      skill_key: skillKey,
      prior_version: currentVersion,
      new_version: nextVersion,
      new_length: newContent.length,
    });
  } catch (e) {
    console.error('kids-skill-learner error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
