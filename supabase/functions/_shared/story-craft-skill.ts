// STORY CRAFT SKILL — distilled from 5 published children's picture books
// (Monkey Pen: Hide-and-Seek, Abe the Service Dog, The Tooth Fairy,
// Angry Ant & the Wise Worm, The Friendly Farmer).
//
// This module is the single source of truth for what makes a kids picture-book
// concept AND manuscript actually pass the story judge. It is injected into
// (a) the concept generator, (b) the manuscript writer, and (c) the story-gate
// reviser so every stage of the pipeline pulls in the same craft, instead of
// each stage inventing its own hopeful advice.
//
// Design goal: after injecting this, a fresh generation should score ~85+ on
// parent_buyer_value, emotional_payoff, and reread_value by default — because
// each rule maps to a QC dimension it demonstrably lifts.

export const PARENT_HOOK_MENU = [
  "first-day fears / starting something new",
  "sharing / taking turns",
  "big feelings — anger, worry, jealousy, sadness",
  "kindness to someone different / being a friend",
  "helping others / being useful",
  "brave first — first haircut, first sleepover, first time alone",
  "childhood ritual / milestone — losing a tooth, birthday, bedtime tuck-in",
  "belonging / making a new friend when you feel left out",
  "courage — trying again after failing",
  "family love / everyday togetherness moment",
  "self-acceptance — what makes me me is good",
  "curiosity / noticing the small wonders of the world",
] as const;

export type ParentHook = typeof PARENT_HOOK_MENU[number];

export interface CraftRule {
  id: string;
  title: string;
  rule: string;
  lifts: string[]; // QC dimension names this rule improves
}

export const CRAFT_RULES: CraftRule[] = [
  {
    id: "parent_hook_anchor",
    title: "PARENT HOOK is chosen FIRST",
    rule: "Before inventing plot or hero, pick ONE developmental theme a parent instantly recognizes from the PARENT_HOOK_MENU (e.g. 'losing a tooth', 'managing anger', 'helping others', 'making a friend when you feel left out'). Every story beat must serve this hook. The parent must be able to say in one breath why they'd buy this book for their child right now.",
    lifts: ["parent_buyer_value", "emotional_payoff", "final_concept_score"],
  },
  {
    id: "small_hero_small_want",
    title: "Small hero, small felt want",
    rule: "Open with the hero doing a small ordinary thing (a game of hide-and-seek, waking up early, going to school). Give them ONE tiny, specific want or worry on page 1 — never a grand quest. Ex: 'Dylan the young blue dragon was lonely.' 'Arnold Ant is always angry.' Simplicity is the point.",
    lifts: ["age_appropriateness", "emotional_payoff", "language_level"],
  },
  {
    id: "concrete_helper_or_ritual",
    title: "One concrete helper, object, or ritual carries the theme",
    rule: "The lesson must be embodied by ONE tangible thing a child can point at: a bottle of 'Anger Medicine' (that's really just water), a Tooth Fairy's health card, Abe's halter, Dylan's white surrender flag. Never deliver the theme as narration or a speech — put it in a physical object or repeated action.",
    lifts: ["parent_buyer_value", "reread_value", "emotional_payoff"],
  },
  {
    id: "escalation_by_repetition",
    title: "Escalation by gentle repetition",
    rule: "Repeat the same action/beat 2–3 times with a small increase in stakes each time. Dylan tries the playground once (kids flee), tries again with a surrender flag (they listen). Sally calls, no answer; calls again, no answer; then hears help. This 'try → fail → try again' rhythm is the picture-book engine — flatter than adult drama, safer than danger.",
    lifts: ["story_coherence", "reread_value", "emotional_payoff"],
  },
  {
    id: "gentle_worry_never_terror",
    title: "Gentle worry, never terror",
    rule: "Peril is real but soft: Sally is stuck in a small cave, not lost forever. Junior wonders about the card, not scared of it. Arnold's shouting scares 'a whole crowd' but nobody is hurt. Use worry a 4-year-old can survive and see resolved in 3 pages.",
    lifts: ["age_appropriateness", "emotional_payoff"],
  },
  {
    id: "implicit_moral_via_action",
    title: "Implicit moral through the hero's own action",
    rule: "Never let a wise adult or narrator say the lesson. The hero performs it. Wise Worm reveals the medicine was only water — Arnold learns HE calmed himself. Dylan's surrender flag IS his apology. The child reader feels the lesson land because the character chose it, not because they were told.",
    lifts: ["parent_buyer_value", "emotional_payoff", "reread_value"],
  },
  {
    id: "final_spread_warm_payoff",
    title: "Final spread = warm, specific payoff that lands the PARENT HOOK",
    rule: "The last page must be a warm, quiet image that pays off the developmental theme in one specific gesture, not a summary. Abe becomes 'a good friend for people in a good family — you really couldn't ask for more.' Dylan gives the children a flight every day. Junior's teeth are healthy. The parent should feel a small lump-in-throat moment. NO 'and they all learned a lesson' sentence.",
    lifts: ["parent_buyer_value", "emotional_payoff", "final_concept_score"],
  },
  {
    id: "chantable_or_ritual_repetition",
    title: "One chantable line OR one ritual sentence a child will echo",
    rule: "Include either (a) a short 4–8 word chantable refrain repeated 3–4× with escalation ('Ready or not, here I come!'), OR (b) a ritual sentence pattern the child will predict and say aloud ('Wash your wings and get ready for tea'; the tooth-fairy card's numbered list). Repetition is the child's contract with the book.",
    lifts: ["reread_value", "language_level"],
  },
  {
    id: "reveal_or_ritual_ending",
    title: "Ending is a small reveal or a completed ritual — never a moral speech",
    rule: "Choose one of two proven endings: (1) SMALL REVEAL — the twist recontextualizes the whole book (the medicine was water; the treasure story becomes a lesson about honesty), or (2) COMPLETED RITUAL — the promised routine finally happens and continues forever after ('From that day, Dylan took the children on the best playground ride ever'). Both make a child want to reread.",
    lifts: ["reread_value", "emotional_payoff", "parent_buyer_value"],
  },
  {
    id: "sensory_read_aloud_voice",
    title: "Sensory, read-aloud voice",
    rule: "Short sentences (≤12 words). Concrete verbs. Named characters. Sound words ('Heave...'; 'AAARRGGGHHH!'; 'Yay!'). A parent reading aloud must be able to do a small voice for each character. Kindergarten cadence, never a chapter-book paragraph.",
    lifts: ["language_level", "age_appropriateness"],
  },
  {
    id: "one_wise_ally",
    title: "One wise ally figure — not a lecturing adult",
    rule: "The hero often meets ONE kind ally who helps sideways, not directly: Wise Worm hands over a placebo, Mummy Dragon suggests the playground, Mark's dad ties the rope. The ally opens a door; the hero walks through. This models being helped without being rescued.",
    lifts: ["parent_buyer_value", "emotional_payoff"],
  },
  {
    id: "world_is_small_and_home_shaped",
    title: "World is small and home-shaped",
    rule: "Setting is a familiar scale: an anthill, a mountain cave, a playground, a bedroom pillow, a farm garden. Not a kingdom, not the world. Small worlds keep the emotional stakes legible to a 4–7 year old.",
    lifts: ["age_appropriateness", "story_coherence"],
  },
];

// Short exemplar patterns — paraphrased from the reference books so the LLM
// can copy the *shape* without copying the words.
export const EXEMPLAR_PATTERNS = {
  opening_formula: [
    "Introduce hero + tiny felt want in ≤3 sentences. Ex (paraphrased): 'Arnold Ant is always angry. He shouts, he screams, and the other ants doubt him.' — sets hero, problem, and stakes in 20 words.",
    "Or a small ordinary scene + a nudge from a caring adult. Ex (paraphrased): 'Dylan the young dragon flew all over the mountains looking for something to do. When he was hungry he went home to Mummy Dragon.' — the world feels safe before the loneliness lands.",
  ],
  refrain_or_ritual_formula: [
    "A short line the child will chant. Ex: 'Ready or not, here I come!' — repeated across pages, escalated by context.",
    "A numbered ritual card, embedded in the story: 1. Eat healthy. 2. Cut down on sweets. 3. Brush twice a day… — turns the moral into a recitable object.",
  ],
  climax_payoff_formula: [
    "Hero tries the small brave thing themselves. Ex (paraphrased): 'Anytime Arnold felt anger rising, he sipped the medicine and shut his eyes. When the ten minutes passed, he could barely remember why he was angry.' — child sees the tool actually work.",
    "Or: hero offers a peace gesture that flips the situation. Ex (paraphrased): 'Dylan tucked a white handkerchief into his gill, held up a surrender flag, and said softly, I just want to play.' — the visual gesture IS the resolution.",
  ],
  closing_ritual_formula: [
    "REVEAL close (paraphrased): 'I did not cure you, Ant. There was only water in the bottle. You calmed yourself.' — the twist reframes the whole book and rewards a second read.",
    "RITUAL close (paraphrased): 'From that day, Dylan and the playground children were friends, and every day Dylan gave them the best playground ride ever.' — a warm forever-after that lands the theme.",
    "FRAME close (paraphrased): 'A long time has passed and now I help my friend meet her new service dog. Then I become a good friend for a good family. You really couldn't ask for more.' — hero passes the gift forward.",
  ],
};

// One string block you paste directly into any system prompt. Keep it dense —
// this is the whole point of the skill.
export function storyCraftBlock(): string {
  const rules = CRAFT_RULES.map((r, i) =>
    `${i + 1}. [${r.id}] ${r.title}\n   ${r.rule}\n   → lifts: ${r.lifts.join(", ")}`
  ).join("\n");
  const hooks = PARENT_HOOK_MENU.map(h => `   - ${h}`).join("\n");
  const openings = EXEMPLAR_PATTERNS.opening_formula.map(s => `   • ${s}`).join("\n");
  const refrains = EXEMPLAR_PATTERNS.refrain_or_ritual_formula.map(s => `   • ${s}`).join("\n");
  const climaxes = EXEMPLAR_PATTERNS.climax_payoff_formula.map(s => `   • ${s}`).join("\n");
  const closes = EXEMPLAR_PATTERNS.closing_ritual_formula.map(s => `   • ${s}`).join("\n");

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STORY CRAFT SKILL (distilled from 5 published picture books)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED PARENT HOOK — pick ONE from this menu FIRST, before anything else:
${hooks}
Every beat of the story must serve this hook. The final spread must land it
as a warm, specific payoff (not a summary sentence).

CRAFT RULES (each is tied to the QC dimension it lifts — follow all 12):
${rules}

EXEMPLAR OPENING FORMULAS:
${openings}

EXEMPLAR REFRAIN / RITUAL FORMULAS:
${refrains}

EXEMPLAR CLIMAX PAYOFF FORMULAS:
${climaxes}

EXEMPLAR CLOSING FORMULAS (choose ONE — reveal, ritual, or frame):
${closes}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// Map failing QC dimensions → the craft rule IDs that most directly lift them.
// Used by the story-gate reviser to give the LLM SPECIFIC craft moves per
// failing dimension rather than generic "try harder" advice.
export const DIMENSION_TO_RULES: Record<string, string[]> = {
  parent_buyer_value: ["parent_hook_anchor", "concrete_helper_or_ritual", "final_spread_warm_payoff", "implicit_moral_via_action"],
  emotional_payoff: ["small_hero_small_want", "final_spread_warm_payoff", "implicit_moral_via_action", "one_wise_ally"],
  reread_value: ["chantable_or_ritual_repetition", "reveal_or_ritual_ending", "escalation_by_repetition", "concrete_helper_or_ritual"],
  language_level: ["sensory_read_aloud_voice", "chantable_or_ritual_repetition"],
  age_appropriateness: ["small_hero_small_want", "gentle_worry_never_terror", "world_is_small_and_home_shaped"],
  story_coherence: ["escalation_by_repetition", "world_is_small_and_home_shaped"],
  generic_risk: ["parent_hook_anchor", "concrete_helper_or_ritual", "reveal_or_ritual_ending"],
};

export function craftRulesForDimension(dimension: string): CraftRule[] {
  const ids = DIMENSION_TO_RULES[dimension] ?? [];
  return CRAFT_RULES.filter(r => ids.includes(r.id));
}

// Compact per-dimension guidance the reviser can paste under each failing dim.
export function repairGuidanceForDimension(dimension: string): string {
  const rules = craftRulesForDimension(dimension);
  if (!rules.length) return "";
  return rules.map(r => `  · [${r.id}] ${r.title} — ${r.rule}`).join("\n");
}
