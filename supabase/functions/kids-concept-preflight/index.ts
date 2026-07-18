// Kids concept preflight — STRICT gate before manuscript generation.
//
// Generates ONE strong concept using the required rich schema (hero, story
// engine, refrain, two callbacks, final payoff, buyer hook, 12 visual beats,
// concept scores). If it fails the strict thresholds, generates EXACTLY TWO
// improved alternatives, scores them, and returns the best passing one.
//
// No image cost, no ebook rows. Story-only cheap step.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadStoryCraftBlock, PARENT_HOOK_MENU } from '../_shared/story-craft-skill.ts';
import { parseModelJson } from '../_shared/model-json.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const BANNED_LANES = [
  'lost object mystery',
  'dance party ending',
  'generic teamwork',
  'bedtime',
  'moon',
  'star ',
  'stars ',
  'emotional regulation',
  'tooth',
  'toothbrush',
  'bathroom',
  'potty',
  'portal',
  'wormhole',
  'sock sorter',
  'farm fiddle',
  'barnyard boogaloo',
  'everyone is special',
];

// LEARNED RULE (2026-07-14) — visually_unambiguous_hero.
// Root cause: Detective Dot's "dust bunny" hero was drawn as a rabbit on 6/28
// interior pages, blowing the character_consistency gate. Image models
// (Gemini flash-image, Fal nano) reliably render CONCRETE, NAMED subjects but
// hallucinate a plausible substitute for abstract / homophone / phrase-based
// heroes ("dust bunny" → rabbit, "shadow" → generic child, "whisper" → mouth).
//
// Rule: the hero MUST be a subject the image model can render unambiguously —
// a specific animal, child, vehicle, robot, or monster with concrete visible
// features. Abstract or ambiguous heroes are blocked unless
// hero_specificity spells out (a) a concrete visual definition AND (b) an
// explicit anti-confusion clause ("NOT a <thing it will be confused with>").
const AMBIGUOUS_HERO_TOKENS: Array<{ token: string; confused_with: string }> = [
  { token: 'dust bunny', confused_with: 'a rabbit / hare / animal with long ears' },
  { token: 'shadow',     confused_with: 'a generic child silhouette or a black blob' },
  { token: 'whisper',    confused_with: 'a floating mouth or generic speech bubble' },
  { token: 'echo',       confused_with: 'sound waves / speech bubbles instead of a character' },
  { token: 'feeling',    confused_with: 'an abstract heart/emoji instead of a body' },
  { token: 'emotion',    confused_with: 'an abstract heart/emoji instead of a body' },
  { token: 'sound',      confused_with: 'a music note without a body' },
  { token: 'smell',      confused_with: 'wavy lines without a body' },
  { token: 'scent',      confused_with: 'wavy lines without a body' },
  { token: 'dream',      confused_with: 'a cloud without a body' },
  { token: 'wish',       confused_with: 'a star / sparkle without a body' },
  { token: 'giggle',     confused_with: 'a mouth without a body' },
  { token: 'thought',    confused_with: 'a thought bubble without a body' },
  { token: 'breeze',     confused_with: 'wind lines without a body' },
  { token: 'mist',       confused_with: 'fog / cloud without a body' },
  { token: 'glow',       confused_with: 'a light halo without a body' },
  { token: 'sparkle',    confused_with: 'a star burst without a body' },
];

function detectAmbiguousHero(c: Concept): { hits: Array<{ token: string; confused_with: string }>; hasAntiConfusion: boolean; hasConcreteVisual: boolean } {
  const heroText = `${c.hero ?? ''} ${c.hero_specificity ?? ''}`.toLowerCase();
  const hits = AMBIGUOUS_HERO_TOKENS.filter(({ token }) => heroText.includes(token));
  const spec = (c.hero_specificity ?? '').toLowerCase();
  const hasAntiConfusion = /\bnot (a|an) [a-z]/.test(spec);
  // "concrete visual" heuristic: mentions size, color, texture, body-part detail
  const hasConcreteVisual = /(size|small|tiny|large|round|fluffy|furry|striped|spotted|feet|paws|eyes|ears|tail|body|arms|legs|nose|whiskers|fur|scales|feathers|color|colou?red)/.test(spec);
  return { hits, hasAntiConfusion, hasConcreteVisual };
}

const PREFERRED_LANES = [
  'food/kitchen chaos with a specific object and escalating rules',
  'animal buddy comedy with a concrete mechanical problem',
  'tiny detective mystery with unusual evidence and callbacks',
  'silly invention with a fresh object',
  'neighborhood micro-adventure with a concrete route/map/object',
  'shop/market/library/museum mishap with a visual logic game',
];

interface VisualBeat { spread: number; visual_beat: string; callback_seed: string }

interface Concept {
  title: string;
  subtitle: string;
  hero: string;
  hero_specificity: string;
  setting: string;
  parent_hook: string;                 // MUST be one of PARENT_HOOK_MENU
  core_story_engine: string;
  central_problem: string;
  story_rule: string;
  refrain: string;
  callback_1: string;
  callback_2: string;
  final_page_payoff: string;
  emotional_payoff_seed: string;
  parent_buyer_hook: string;
  why_child_will_reread: string;
  why_parent_will_buy: string;
  twelve_spread_visual_plan_seed: VisualBeat[];
  forbidden_similarity_check: string[];
  lane: string;
}

interface ConceptScores {
  distinctiveness_score: number;
  story_engine_score: number;
  reread_mechanism_score: number;
  parent_buyer_value_score: number;
  emotional_payoff_seed_score: number;
  visual_spread_potential_score: number;
  age_fit_score: number;
  generic_risk_score: number;
  final_concept_score: number;
}

interface JudgedConcept {
  concept: Concept;
  concept_scores: ConceptScores;
  decision: 'pass' | 'rewrite' | 'reject';
  passed: boolean;
  blockers: string[];
  banned_lane_hits: string[];
  weak_dimensions: Array<{ dimension: string; score: number; note: string }>;
}

// SOFT thresholds — informational only, surfaced as weak_dimensions so the
// writer can strengthen them. Hard gate uses FLOOR/GENERIC_MAX below.
const SOFT_MIN = 90;
const T = {
  distinctiveness_score: SOFT_MIN,
  story_engine_score: SOFT_MIN,
  reread_mechanism_score: SOFT_MIN,
  parent_buyer_value_score: SOFT_MIN,
  emotional_payoff_seed_score: SOFT_MIN,
  visual_spread_potential_score: SOFT_MIN,
  age_fit_score: SOFT_MIN,
  generic_risk_score: 25,
  final_concept_score: SOFT_MIN,
};

// HARD gate: concept stage is a best-of selector, not a product-grade gate.
// Real quality bars live at story_gate (>=85 per dim) and final QC (>=90).
const CONCEPT_SCORE_FLOOR = 85;   // final_concept_score must be >= this
const CONCEPT_GENERIC_MAX = 40;   // generic_risk_score must be <= this

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
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const raw = String(j?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  return raw;
}

function safeJson<T>(raw: string): T {
  const r = parseModelJson<T>(raw);
  if (r.ok) return r.value;
  throw new Error(`bad json: ${r.diagnostics.errors.slice(-1)[0] ?? "unknown"} — ${r.diagnostics.raw_excerpt.slice(0, 200)}`);
}

function detectBannedLaneHits(c: Concept): string[] {
  const hay = [
    c.title, c.subtitle, c.hero, c.hero_specificity, c.setting, c.core_story_engine,
    c.central_problem, c.story_rule, c.refrain, c.callback_1, c.callback_2,
    c.final_page_payoff, c.emotional_payoff_seed, c.parent_buyer_hook,
    c.why_child_will_reread, c.why_parent_will_buy, c.lane,
  ].join(' \n ').toLowerCase();
  return BANNED_LANES.filter(b => hay.includes(b));
}

const LANE_DIRECTIVES: Record<string, string> = {
  food_kitchen_chaos: 'ALL candidates must sit in the food/kitchen chaos lane: a specific edible object escalates chaos across a real kitchen with concrete rules (whisks, batter, jars, timers, aprons).',
  tiny_detective: 'ALL candidates must sit in the tiny detective lane: a small hero investigates unusual physical evidence (crumb trails, missing buttons, odd footprints) with a visual logic game.',
  animal_buddy_mechanical: 'ALL candidates must sit in the animal buddy mechanical problem lane: an animal helper fixes a concrete mechanical/physical malfunction (wobbly wheel, stuck lid, broken bell).',
  neighborhood_micro_adventure: 'ALL candidates must sit in the neighborhood micro-adventure lane: a route/map/errand through a specific local block with concrete objects (mailbox, corner shop, park bench).',
  shop_library_museum_logic: 'ALL candidates must sit in the shop/library/museum mishap lane with a visual logic game (mislabeled shelves, out-of-order exhibits, price-tag swap).',
};

interface RecentConceptSignal {
  titles: string[];
  heroes: string[];
  quirks: string[];        // hero_specificity / adjective+noun signatures
  settings: string[];
  refrains: string[];
}

async function loadRecentConceptSignals(db: ReturnType<typeof createClient>, limit = 25): Promise<RecentConceptSignal> {
  // Pull the last N attempted concepts (successful OR failed, published OR not)
  // so the generator sees the FULL recent minting history and doesn't rediscover
  // the same protagonist template. Live/sellable titles are the strongest anchors
  // — include them all regardless of age.
  const { data } = await db
    .from('ebooks_kids')
    .select('title, storefront_meta, updated_at')
    .not('title', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  const titles: string[] = [];
  const heroes: string[] = [];
  const quirks: string[] = [];
  const settings: string[] = [];
  const refrains: string[] = [];
  for (const row of data ?? []) {
    const t = String((row as { title?: string }).title ?? '').trim();
    if (t && !/preflight in progress|coloring book/i.test(t)) titles.push(t);
    const meta = (row as { storefront_meta?: Record<string, unknown> }).storefront_meta ?? {};
    const brief = (meta.concept_brief ?? meta.locked_concept ?? {}) as Record<string, unknown>;
    const hero = String(brief.hero ?? '').trim();
    if (hero) heroes.push(hero);
    const spec = String(brief.hero_specificity ?? '').trim();
    if (spec) quirks.push(spec.slice(0, 140));
    const set = String(brief.setting ?? '').trim();
    if (set) settings.push(set.slice(0, 80));
    const ref = String(brief.refrain ?? '').trim();
    if (ref) refrains.push(ref);
  }
  return { titles, heroes, quirks, settings, refrains };
}

// Extract the "protagonist quirk template" (e.g. "wobbly X", "sneezy X",
// "sticky X", "sleepy X") from recent titles/heroes so we can explicitly
// forbid the writer from producing another one.
function extractQuirkTemplates(recent: RecentConceptSignal): string[] {
  const adjRx = /\b(wobbly|wobble|sticky|sneezy|sneez|sleepy|dizzy|bouncy|bounce|wiggly|wiggle|jiggly|floppy|grumpy|itchy|scratchy|crumbly|fluffy|squishy|squeaky|silly|giggly|whispery|bumpy|clumsy|hiccupy|hiccup|drowsy|snuffly|creaky|shaky|chubby|tiny|little|wobbling|wandering|lost|missing|magical|curious|peculiar|puzzling|mystery|mysterious)\b/gi;
  const set = new Set<string>();
  const seed = [...recent.titles, ...recent.heroes, ...recent.quirks];
  for (const s of seed) {
    const m = s.toLowerCase().match(adjRx);
    if (m) for (const a of m) set.add(a);
  }
  return Array.from(set);
}

// Extract the recurring proper-name protagonists (Pip, Leo, Barnaby, ...)
// so the writer is forced to pick a fresh name.
function extractProtagonistNames(recent: RecentConceptSignal): string[] {
  const nameRx = /\b([A-Z][a-z]{2,12})\b/g;
  const stop = new Set(['The','And','But','With','Little','Big','Chef','Detective','Captain','Miss','Mister','Mr','Mrs','Ms','Doctor','Dr','A','An','It','Its','Not','No','Yes','On','In','At','To','From','For','Of','By','As','My','Your','His','Her','Their','This','That','These','Those','Peculiar','Curious','Puzzling','Mystery','Mysterious','Wobbly','Sticky','Sneezy','Sleepy','Dizzy','Bouncy','Wiggly','Fluffy','Squishy']);
  const counts = new Map<string, number>();
  for (const t of [...recent.titles, ...recent.heroes]) {
    let m: RegExpExecArray | null;
    while ((m = nameRx.exec(t)) !== null) {
      const n = m[1];
      if (stop.has(n)) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).filter(([, c]) => c >= 1).map(([n]) => n).slice(0, 30);
}

async function generateConcept(ageBand: string, avoidList: string[], attemptLabel: string, skillBlock: string, batchLane: string | undefined, recent: RecentConceptSignal): Promise<Concept> {
  const avoidBlock = avoidList.length
    ? `\n\nDo NOT repeat/rehash these previously-tried concepts:\n${avoidList.map(a => `- ${a}`).join('\n')}`
    : '';

  const laneDirective = batchLane && LANE_DIRECTIVES[batchLane]
    ? `\n\nBATCH LANE (STRICT): ${LANE_DIRECTIVES[batchLane]} If your concept does not fit this lane, REGENERATE inside the lane.`
    : '';

  // --- ANTI-ANCHORING BLOCK ---------------------------------------------
  // The recent runs proved the generator anchors on the shape of the last
  // published success (protagonist-name + adjective-quirk template, e.g.
  // "Barnaby's Wobbly Problem" → "Leo's Wobbly Bicycle" / "Wobbly Wobbles").
  // We force the model to (a) see the exact recent list, (b) forbid re-using
  // any hero name or adjective-quirk template, (c) require a distinct
  // premise/setting/name axis.
  const recentTitleList = recent.titles.slice(0, 20);
  const recentHeroList = Array.from(new Set(recent.heroes)).slice(0, 20);
  const recentQuirkList = extractQuirkTemplates(recent);
  const recentNames = extractProtagonistNames(recent);
  const recentSettingList = Array.from(new Set(recent.settings)).slice(0, 15);
  const antiAnchorBlock = `\n\nANTI-ANCHORING (HARD): the previous batch produced near-clones by anchoring on the shape of the last published success. You MUST break every one of these anchors:
- FORBIDDEN protagonist NAMES (already used in the last ${recent.titles.length} attempts — pick a fresh name, not on this list): ${recentNames.length ? recentNames.join(', ') : '(none yet)'}
- FORBIDDEN quirk adjectives in the title, subtitle, hero, or hero_specificity (the "adjective-noun template" template is over-used — DO NOT reuse ANY of these): ${recentQuirkList.length ? recentQuirkList.join(', ') : '(none yet)'}
- FORBIDDEN hero archetypes (already tried): ${recentHeroList.length ? recentHeroList.join(' | ') : '(none yet)'}
- FORBIDDEN settings (already tried, pick a genuinely different one): ${recentSettingList.length ? recentSettingList.join(' | ') : '(none yet)'}
- FORBIDDEN titles (do not riff on, echo, or vary these): ${recentTitleList.length ? recentTitleList.map(t => `"${t}"`).join(', ') : '(none yet)'}

Your concept must be distinct on ALL FOUR axes:
  1) premise (different core mechanic / story engine),
  2) protagonist name (not on the forbidden list, no "-y" adjective-quirk template like "Wobbly ___", "Sleepy ___", "Sticky ___", "Sneezy ___", "Dizzy ___", "Bouncy ___"),
  3) setting (different physical world),
  4) quirk (the hero's problem/skill is not an adjective-noun template).

If your first idea rhymes with, echoes, alliterates on, or shares a template with anything on the forbidden list above, THROW IT OUT and invent a fresh one before writing the JSON. The generic_risk gate will reject anchor-clones.`;

  const system = `You are a bestselling picture-book concept designer for ages ${ageBand}. Invent ONE original, distinctive, giftable picture-book concept.

${skillBlock}

CRITICAL ORDER OF INVENTION (do not skip):
1. Pick the PARENT_HOOK first from the menu above (rule: parent_hook_anchor). Every downstream choice must serve it.
2. Invent the STORY ENGINE (the escalating mechanism/rule).
3. Invent the CALLBACKS — two concrete planted objects that pay off.
4. Invent the FINAL PAGE PAYOFF that lands the parent hook in ONE warm specific image.
5. Only THEN write the TITLE. The title must describe the mechanism, not just a funny name.
Reject concepts that are funny-name-first with no mechanism, or concepts with no parent hook.${laneDirective}${antiAnchorBlock}

Reply as STRICT JSON only (no markdown fences), matching EXACTLY this schema:
{
  "title": "",
  "subtitle": "",
  "hero": "",
  "hero_specificity": "",
  "setting": "",
  "parent_hook": "",
  "core_story_engine": "",
  "central_problem": "",
  "story_rule": "",
  "refrain": "",
  "callback_1": "",
  "callback_2": "",
  "final_page_payoff": "",
  "emotional_payoff_seed": "",
  "parent_buyer_hook": "",
  "why_child_will_reread": "",
  "why_parent_will_buy": "",
  "twelve_spread_visual_plan_seed": [
    {"spread": 1, "visual_beat": "", "callback_seed": ""},
    {"spread": 2, "visual_beat": "", "callback_seed": ""},
    {"spread": 3, "visual_beat": "", "callback_seed": ""},
    {"spread": 4, "visual_beat": "", "callback_seed": ""},
    {"spread": 5, "visual_beat": "", "callback_seed": ""},
    {"spread": 6, "visual_beat": "", "callback_seed": ""},
    {"spread": 7, "visual_beat": "", "callback_seed": ""},
    {"spread": 8, "visual_beat": "", "callback_seed": ""},
    {"spread": 9, "visual_beat": "", "callback_seed": ""},
    {"spread": 10, "visual_beat": "", "callback_seed": ""},
    {"spread": 11, "visual_beat": "", "callback_seed": ""},
    {"spread": 12, "visual_beat": "", "callback_seed": ""}
  ],
  "forbidden_similarity_check": [],
  "lane": ""
}

REQUIREMENTS (all mandatory):
- parent_hook MUST be one of the PARENT_HOOK_MENU strings, copied verbatim: ${PARENT_HOOK_MENU.map(h => `"${h}"`).join(' | ')}
- concrete hero with a SPECIFIC want/problem (hero_specificity must name one concrete quirk/skill/object)
- core_story_engine that produces page-turn ACTIONS (not a theme statement)
- central_problem is a concrete, physical, escalating problem
- story_rule is a one-line rule the reader can predict from (e.g. "every time X happens, Y")
- refrain is 4-8 words, chantable, 4-beat, memorable — a child WILL shout it
- callback_1 and callback_2 are small concrete objects/sounds/actions planted by spread 4 that PAY OFF on the final spread
- final_page_payoff is a specific joke/reveal tying BOTH callbacks together
- emotional_payoff_seed is warm and specific (not "everyone learns they are special")
- parent_buyer_hook is specific and giftable (occasion, value, moment)
- why_child_will_reread names the exact reread mechanic
- why_parent_will_buy names the exact buyer motivation
- twelve_spread_visual_plan_seed has 12 DISTINCT visual beats, each with a callback_seed
- lane MUST be one of: ${PREFERRED_LANES.join(' | ')}
- forbidden_similarity_check must list 3-5 famous books/concepts this concept does NOT copy

DO NOT PRODUCE:
- lost object mystery, dance party ending, generic teamwork lesson
- bedtime, moon, stars
- emotional-regulation-only concepts
- tooth/bathroom/potty
- portal/wormhole
- sock sorter (already used), farm fiddle / barnyard boogaloo (already shelved)
- "everyone learns they are special" without a concrete mechanism
- funny-name-first concepts without a real mechanism (e.g., "The Wobbly-Wumpus" with no engine)

Aim WEIRD, SPECIFIC, MEMORABLE. Title must be unswappable with any other picture book.

VISUALLY UNAMBIGUOUS HERO (HARD RULE — image models must be able to render the hero the same way every page):
- The hero MUST be a concrete, nameable subject an image model renders reliably: a specific animal, child, robot, vehicle, or monster with concrete visible features.
- Avoid abstract or ambiguous heroes (dust bunny, shadow, whisper, echo, feeling, sound, smell, dream, wish, giggle, breeze, mist, glow, sparkle) — image models will silently substitute a lookalike (a "dust bunny" gets drawn as a rabbit).
- If you MUST use such a hero, hero_specificity MUST contain BOTH: (a) a concrete visual definition naming size, body parts, colour, texture; AND (b) an explicit anti-confusion clause using the phrase "NOT a <thing it will be confused with>" (e.g. "a round fluffy ball of gray dust with tiny sock feet and two black button eyes — NOT a rabbit, NOT any animal with long ears").

Attempt label: ${attemptLabel}.`;

  const user = `Generate ONE fresh concept for ages ${ageBand}. English only. Strict JSON only.${avoidBlock}`;
  const raw = await callGemini(system, user);
  return safeJson<Concept>(raw);
}

async function scoreConcept(c: Concept, ageBand: string): Promise<ConceptScores> {
  const system = `You are a STRICT calibrated children's-book concept judge. Score the concept on the following dimensions (0-100). Return STRICT JSON only:
{
  "distinctiveness_score": 0,
  "story_engine_score": 0,
  "reread_mechanism_score": 0,
  "parent_buyer_value_score": 0,
  "emotional_payoff_seed_score": 0,
  "visual_spread_potential_score": 0,
  "age_fit_score": 0,
  "generic_risk_score": 0,
  "final_concept_score": 0
}

Polarity:
- distinctiveness_score: higher = more unique, unswappable title
- story_engine_score: higher = page-turn actions (not a theme)
- reread_mechanism_score: higher = refrain + callbacks reward rereading
- parent_buyer_value_score: higher = specific giftable buyer hook (no preaching)
- emotional_payoff_seed_score: higher = specific warm payoff (not generic)
- visual_spread_potential_score: higher = 12 varied visual beats with comic payoff
- age_fit_score: higher = perfect for ${ageBand}
- generic_risk_score: HIGHER = MORE GENERIC (BAD). Penalize lost-object/dance-party/teamwork/bedtime/tooth/portal/moon lanes.
- final_concept_score: overall weighted score (25% distinctiveness, 20% reread, 20% parent_buyer, 15% story_engine, 10% visual, 10% emotional_payoff)

BE STRICT. If the refrain is not truly chantable → reread_mechanism_score <80. If callbacks don't tie together on the final page → distinctiveness AND reread mechanism <80. If buyer hook is vague → parent_buyer_value_score <80. If title could belong to any generic kids book → distinctiveness <70 and generic_risk >60.`;

  const user = `CONCEPT:\n${JSON.stringify(c, null, 2)}\n\nReturn strict JSON only.`;
  const raw = await callGemini(system, user);
  return safeJson<ConceptScores>(raw);
}

function evaluate(scores: ConceptScores, bannedHits: string[], c: Concept): {
  passed: boolean;
  blockers: string[];
  weak_dimensions: Array<{ dimension: string; score: number; note: string }>;
  decision: 'pass' | 'rewrite' | 'reject';
} {
  // HARD blockers only — banned lanes, structural incompleteness, and the
  // composite floors. Per-dimension SOFT_MIN misses become weak_dimensions.
  const blockers: string[] = [];
  const weak: Array<{ dimension: string; score: number; note: string }> = [];

  const softChecks: Array<[keyof typeof T, number, string]> = [
    ['distinctiveness_score', scores.distinctiveness_score, 'sharpen unique premise / unswappable title'],
    ['story_engine_score', scores.story_engine_score, 'make the page-turn mechanism explicit and escalating'],
    ['reread_mechanism_score', scores.reread_mechanism_score, 'strengthen refrain + callbacks payoff'],
    ['parent_buyer_value_score', scores.parent_buyer_value_score, 'name the specific giftable buyer moment'],
    ['emotional_payoff_seed_score', scores.emotional_payoff_seed_score, 'build a warm specific emotional arc with a payoff on the final spread'],
    ['visual_spread_potential_score', scores.visual_spread_potential_score, 'make each spread visually distinct with comic payoff'],
    ['age_fit_score', scores.age_fit_score, 'tighten vocabulary/pacing to age band'],
  ];
  for (const [k, v, note] of softChecks) {
    if (v < T[k]) weak.push({ dimension: String(k), score: v, note });
  }

  if (bannedHits.length) blockers.push(`banned_lane_hits=[${bannedHits.join(',')}]`);
  if (!c.twelve_spread_visual_plan_seed || c.twelve_spread_visual_plan_seed.length < 12) {
    blockers.push(`visual_plan_seed<12 (got ${c.twelve_spread_visual_plan_seed?.length ?? 0})`);
  }
  if (!c.callback_1 || !c.callback_2 || !c.final_page_payoff) {
    blockers.push('missing_callbacks_or_final_payoff');
  }
  if (!c.refrain || c.refrain.split(/\s+/).length < 3) {
    blockers.push('refrain_too_short');
  }
  if (!c.parent_hook || !(PARENT_HOOK_MENU as readonly string[]).includes(c.parent_hook)) {
    blockers.push(`parent_hook_missing_or_off_menu (got "${(c.parent_hook ?? '').slice(0, 60)}")`);
  }
  if (scores.final_concept_score < CONCEPT_SCORE_FLOOR) {
    blockers.push(`final_concept_score=${scores.final_concept_score}<${CONCEPT_SCORE_FLOOR}`);
  }
  if (scores.generic_risk_score > CONCEPT_GENERIC_MAX) {
    blockers.push(`generic_risk_score=${scores.generic_risk_score}>${CONCEPT_GENERIC_MAX}`);
  }

  // Visually unambiguous hero — learned rule (character_consistency).
  const amb = detectAmbiguousHero(c);
  if (amb.hits.length && (!amb.hasAntiConfusion || !amb.hasConcreteVisual)) {
    const hitList = amb.hits.map(h => `${h.token} (will be confused with ${h.confused_with})`).join('; ');
    blockers.push(`visually_unambiguous_hero: ambiguous hero [${hitList}] without concrete visual definition + explicit "NOT a X" anti-confusion clause in hero_specificity`);
  }

  const passed = blockers.length === 0;
  const decision: 'pass' | 'rewrite' | 'reject' = passed
    ? 'pass'
    : (scores.final_concept_score >= 70 && scores.generic_risk_score <= 50 && bannedHits.length === 0 ? 'rewrite' : 'reject');
  return { passed, blockers, weak_dimensions: weak, decision };
}

function compositeScore(s: ConceptScores): number {
  return s.final_concept_score
    || (s.distinctiveness_score * 0.25
      + s.reread_mechanism_score * 0.20
      + s.parent_buyer_value_score * 0.20
      + s.story_engine_score * 0.15
      + s.visual_spread_potential_score * 0.10
      + s.emotional_payoff_seed_score * 0.10
      - Math.max(0, s.generic_risk_score - 25) * 0.5);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const ageBand: string = body.age_band ?? '4-6';
    const batchLane: string | undefined = typeof body.batch_lane === 'string' ? body.batch_lane : undefined;
    const seedAvoid: string[] = Array.isArray(body.avoid_titles) ? body.avoid_titles.filter((s: unknown) => typeof s === 'string') : [];

    const judged: JudgedConcept[] = [];
    const triedTitles: string[] = [...seedAvoid];

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const skillBlock = await loadStoryCraftBlock(db, ageBand);

    // Attempt 1
    let c1: Concept;
    try {
      c1 = await generateConcept(ageBand, triedTitles, 'primary', skillBlock, batchLane);
    } catch (e) {
      return json({ ok: false, error: `concept1_gen_failed: ${(e as Error).message.slice(0, 200)}` }, 500);
    }
    triedTitles.push(c1.title);
    const s1 = await scoreConcept(c1, ageBand);
    const b1 = detectBannedLaneHits(c1);
    const e1 = evaluate(s1, b1, c1);
    judged.push({ concept: c1, concept_scores: s1, decision: e1.decision, passed: e1.passed, blockers: e1.blockers, banned_lane_hits: b1, weak_dimensions: e1.weak_dimensions });

    // Exactly TWO alternatives if first fails
    if (!e1.passed) {
      for (let i = 0; i < 2; i++) {
        try {
          const cN = await generateConcept(ageBand, triedTitles, `alt${i + 1}_addressing:${e1.blockers.slice(0, 3).join(';')}`, skillBlock, batchLane);
          triedTitles.push(cN.title);
          const sN = await scoreConcept(cN, ageBand);
          const bN = detectBannedLaneHits(cN);
          const eN = evaluate(sN, bN, cN);
          judged.push({ concept: cN, concept_scores: sN, decision: eN.decision, passed: eN.passed, blockers: eN.blockers, banned_lane_hits: bN, weak_dimensions: eN.weak_dimensions });
          if (eN.passed) break;
        } catch (e) {
          judged.push({
            concept: {} as Concept,
            concept_scores: {
              distinctiveness_score: 0, story_engine_score: 0, reread_mechanism_score: 0,
              parent_buyer_value_score: 0, emotional_payoff_seed_score: 0, visual_spread_potential_score: 0,
              age_fit_score: 0, generic_risk_score: 100, final_concept_score: 0,
            },
            decision: 'reject',
            passed: false,
            blockers: [`alt${i + 1}_gen_failed: ${(e as Error).message.slice(0, 160)}`],
            banned_lane_hits: [],
            weak_dimensions: [],
          });
        }
      }
    }

    const passedList = judged.filter(j => j.passed);
    const winner = passedList.length > 0
      ? passedList.sort((a, b) => compositeScore(b.concept_scores) - compositeScore(a.concept_scores))[0]
      : judged.sort((a, b) => compositeScore(b.concept_scores) - compositeScore(a.concept_scores))[0];

    return json({
      ok: true,
      age_band: ageBand,
      candidates: judged,
      winner,
      overall_passed: winner.passed,
      thresholds: T,
      floor: { final_concept_score: CONCEPT_SCORE_FLOOR, generic_risk_score: CONCEPT_GENERIC_MAX },
      selection_mode: 'best_of_floor',
    });
  } catch (e) {
    console.error('kids-concept-preflight error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
