// Kids concept preflight.
//
// Given an age band and optional theme hint, generate ONE rich concept brief
// (with refrain / planted callbacks / final payoff / buyer hook), then score
// it against a strict rubric. If it fails, generate exactly TWO alternatives,
// score them, and return the best of the three (may still fail, in which case
// caller should shelve).
//
// This is a story-only cheap step — no image cost, no ebook rows created.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const BANNED_LANES = [
  'lost object mystery',
  'dance party ending',
  'generic teamwork lesson',
  'bedtime',
  'moon',
  'star',
  'emotional regulation',
  'tooth',
  'toothbrush',
  'bathroom',
  'potty',
  'portal',
  'wormhole',
  'sock sorter',
  'sock',
  'farm fiddle',
  'fiddle',
];

const PREFERRED_LANES = [
  'food/kitchen chaos with a highly specific object',
  'animal buddy comedy with a concrete mechanical problem',
  'tiny detective mystery with an unusual evidence trail',
  'silly invention with a non-repeated object',
  'neighborhood micro-adventure',
];

interface Concept {
  title: string;
  subtitle: string;
  hero: string;
  setting: string;
  story_engine: string;
  refrain: string;
  callback_1: string;
  callback_2: string;
  final_page_payoff: string;
  reread_hook: string;
  parent_buyer_hook: string;
  visual_spread_plan_seed: string[];
  lane: string;
}

interface ConceptScores {
  distinctiveness: number;
  reread_potential: number;
  parent_buyer_value: number;
  visual_hook_strength: number;
  age_fit: number;
  generic_risk: number;
}

interface JudgedConcept {
  concept: Concept;
  scores: ConceptScores;
  passed: boolean;
  blockers: string[];
  banned_lane_hits: string[];
}

const THRESHOLDS = {
  distinctiveness: 85,
  reread_potential: 85,
  parent_buyer_value: 85,
  visual_hook_strength: 80,
  age_fit: 90,
  generic_risk: 25, // <=
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function callGemini(system: string, user: string, model = 'google/gemini-2.5-flash'): Promise<string> {
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
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}

function detectBannedLaneHits(c: Concept): string[] {
  const hay = [
    c.title, c.subtitle, c.hero, c.setting, c.story_engine, c.refrain,
    c.callback_1, c.callback_2, c.final_page_payoff, c.reread_hook, c.parent_buyer_hook, c.lane,
  ].join(' \n ').toLowerCase();
  return BANNED_LANES.filter(b => hay.includes(b));
}

async function generateConcept(ageBand: string, avoidList: string[]): Promise<Concept> {
  const avoidBlock = avoidList.length
    ? `\n\nDo NOT repeat these previously-tried concepts:\n${avoidList.map(a => `- ${a}`).join('\n')}`
    : '';

  const system = `You are a bestselling picture-book concept designer. You invent one original, distinctive kids' picture-book concept for ${ageBand}-year-olds.
Reply as strict JSON only (no markdown fences, no explanations). Schema:
{
  "title": "",
  "subtitle": "",
  "hero": "",
  "setting": "",
  "story_engine": "",
  "refrain": "",
  "callback_1": "",
  "callback_2": "",
  "final_page_payoff": "",
  "reread_hook": "",
  "parent_buyer_hook": "",
  "visual_spread_plan_seed": ["spread 1...", "..."],
  "lane": ""
}
The concept MUST:
- Have a distinctive story engine that cannot be retitled into a generic book.
- Have a repeated chantable refrain a 4-6-year-old will shout on rereads (4-8 words, 4-beat).
- Have TWO planted callbacks (small concrete objects/sounds/actions) introduced by spread 4 that PAY OFF on the final spread.
- Final page payoff is a specific joke/reveal tied to BOTH callbacks.
- Give an implicit warm parent-buyer takeaway (never preachy/moral speech).
- Offer 12 visually varied spread ideas (list at least 12 short beats).
- Fit one of these lanes: ${PREFERRED_LANES.join('; ')}.

The concept MUST NOT be about:
- lost object mystery, dance party ending, generic teamwork lesson
- bedtime, moon, stars, tooth/bathroom lanes
- portals/wormholes
- sock sorters (already used)
- farm-fiddle boogaloo (already used and shelved)

Aim for weird, specific, memorable. The title should be un-swappable with any other picture book.`;

  const user = `Generate ONE fresh concept for ages ${ageBand}. English only. Strict JSON only.${avoidBlock}`;
  const raw = await callGemini(system, user);
  return JSON.parse(raw) as Concept;
}

async function scoreConcept(c: Concept, ageBand: string): Promise<ConceptScores> {
  const system = `You are a strict calibrated children's-book concept judge. You score a proposed concept on 6 dimensions (0-100). Return STRICT JSON only, no markdown, matching:
{
  "distinctiveness": 0,
  "reread_potential": 0,
  "parent_buyer_value": 0,
  "visual_hook_strength": 0,
  "age_fit": 0,
  "generic_risk": 0
}
Polarity:
- distinctiveness: higher = more unique, unswappable
- reread_potential: higher = a child will demand rereads
- parent_buyer_value: higher = a parent wants to buy/gift (WITHOUT moral speech)
- visual_hook_strength: higher = 12 spreads offer variety and comic visual payoff
- age_fit: higher = perfect for ${ageBand}
- generic_risk: HIGHER = MORE GENERIC (bad). Penalize lost-object mysteries, dance-party endings, generic teamwork lessons, bedtime, tooth/bathroom, portal, moon/star lanes.

Be strict. If refrain is not truly chantable, penalize reread_potential. If callbacks are vague or the final payoff does not tie to BOTH, penalize distinctiveness AND reread_potential. If the takeaway sounds preachy, penalize parent_buyer_value.`;

  const user = `CONCEPT TO SCORE:\n${JSON.stringify(c, null, 2)}\n\nReturn strict JSON only.`;
  const raw = await callGemini(system, user);
  return JSON.parse(raw) as ConceptScores;
}

function evaluate(scores: ConceptScores, bannedHits: string[]): { passed: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (scores.distinctiveness < THRESHOLDS.distinctiveness) blockers.push(`distinctiveness=${scores.distinctiveness}<${THRESHOLDS.distinctiveness}`);
  if (scores.reread_potential < THRESHOLDS.reread_potential) blockers.push(`reread_potential=${scores.reread_potential}<${THRESHOLDS.reread_potential}`);
  if (scores.parent_buyer_value < THRESHOLDS.parent_buyer_value) blockers.push(`parent_buyer_value=${scores.parent_buyer_value}<${THRESHOLDS.parent_buyer_value}`);
  if (scores.visual_hook_strength < THRESHOLDS.visual_hook_strength) blockers.push(`visual_hook_strength=${scores.visual_hook_strength}<${THRESHOLDS.visual_hook_strength}`);
  if (scores.age_fit < THRESHOLDS.age_fit) blockers.push(`age_fit=${scores.age_fit}<${THRESHOLDS.age_fit}`);
  if (scores.generic_risk > THRESHOLDS.generic_risk) blockers.push(`generic_risk=${scores.generic_risk}>${THRESHOLDS.generic_risk}`);
  if (bannedHits.length) blockers.push(`banned_lane_hits=[${bannedHits.join(',')}]`);
  return { passed: blockers.length === 0, blockers };
}

function compositeScore(s: ConceptScores): number {
  // Weighted composite for ranking; heavier weight on reread + distinctiveness + buyer.
  return s.distinctiveness * 0.25
    + s.reread_potential * 0.25
    + s.parent_buyer_value * 0.20
    + s.visual_hook_strength * 0.10
    + s.age_fit * 0.10
    + (100 - s.generic_risk) * 0.10;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const ageBand: string = body.age_band ?? '4-6';

    const judged: JudgedConcept[] = [];
    const triedTitles: string[] = [];

    // Attempt 1
    let c1: Concept;
    try {
      c1 = await generateConcept(ageBand, []);
    } catch (e) {
      return json({ ok: false, error: `concept1_gen_failed: ${(e as Error).message.slice(0, 200)}` }, 500);
    }
    triedTitles.push(c1.title);
    const s1 = await scoreConcept(c1, ageBand);
    const b1 = detectBannedLaneHits(c1);
    const e1 = evaluate(s1, b1);
    judged.push({ concept: c1, scores: s1, passed: e1.passed, blockers: e1.blockers, banned_lane_hits: b1 });

    if (!e1.passed) {
      // Two alternatives, capped.
      for (let i = 0; i < 2; i++) {
        try {
          const cN = await generateConcept(ageBand, triedTitles);
          triedTitles.push(cN.title);
          const sN = await scoreConcept(cN, ageBand);
          const bN = detectBannedLaneHits(cN);
          const eN = evaluate(sN, bN);
          judged.push({ concept: cN, scores: sN, passed: eN.passed, blockers: eN.blockers, banned_lane_hits: bN });
          if (eN.passed) break;
        } catch (e) {
          judged.push({
            concept: {} as Concept,
            scores: { distinctiveness: 0, reread_potential: 0, parent_buyer_value: 0, visual_hook_strength: 0, age_fit: 0, generic_risk: 100 },
            passed: false,
            blockers: [`alt${i + 1}_gen_failed: ${(e as Error).message.slice(0, 160)}`],
            banned_lane_hits: [],
          });
        }
      }
    }

    // Pick the winner: prefer any passed; else highest composite.
    const passed = judged.filter(j => j.passed);
    const winner = passed.length > 0
      ? passed.sort((a, b) => compositeScore(b.scores) - compositeScore(a.scores))[0]
      : judged.sort((a, b) => compositeScore(b.scores) - compositeScore(a.scores))[0];

    return json({
      ok: true,
      age_band: ageBand,
      candidates: judged,
      winner,
      overall_passed: winner.passed,
    });
  } catch (e) {
    console.error('kids-concept-preflight error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
