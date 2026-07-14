// STORY CRAFT SKILL — the pipeline's playbook for writing children's picture
// books that actually pass the story judge.
//
// Distilled from (a) 5 published Monkey Pen picture books and (b) worldwide
// editorial/agent guidance, Nielsen buyer research, award criteria, and
// read-aloud research supplied by the product owner.
//
// This module has TWO shapes:
//   1. Bundled constants (this file) — used as the fallback if the DB read
//      fails, and as the initial seed for the pipeline_skills table.
//   2. Async DB loader `loadStoryCraftBlock(db, ageBand)` — reads the latest
//      version of every skill section from the `pipeline_skills` table so the
//      auto skill-learner (`kids-skill-learner`) can improve the playbook over
//      time. Every prompt-building call site should prefer the async loader.
//
// Design contract: every craft rule + every playbook section names the QC
// dimension it lifts. When the learner sees repeated failures on a dimension
// it writes a new, more specific section targeting that same dimension.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────────────────────
// PARENT HOOK MENU — the required developmental theme every book must anchor.
// ─────────────────────────────────────────────────────────────────────────────

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
  "telling the truth",
  "patience / waiting for something good",
  "teamwork / working together",
  "being different is OK",
  "welcoming a new sibling",
] as const;
export type ParentHook = typeof PARENT_HOOK_MENU[number];

// ─────────────────────────────────────────────────────────────────────────────
// CORE CRAFT RULES — the twelve non-negotiables from the sample books.
// ─────────────────────────────────────────────────────────────────────────────

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
    rule: "Before inventing plot or hero, pick ONE developmental theme a parent instantly recognizes from PARENT_HOOK_MENU. Every story beat must serve this hook. The parent must be able to say in one breath why they'd buy this book for their child right now.",
    lifts: ["parent_buyer_value", "emotional_payoff", "final_concept_score"],
  },
  {
    id: "hero_solves_it_themselves",
    title: "The child/hero solves the problem themselves",
    rule: "The hero — never an adult, never a magic outside rescue — makes the choice that resolves the story. Adults exist to offer a nudge (Wise Worm hands over a placebo bottle; Mummy Dragon suggests the playground) but the hero performs the brave act. This is the single biggest lift for emotional_payoff and parent_buyer_value.",
    lifts: ["emotional_payoff", "parent_buyer_value", "reread_value"],
  },
  {
    id: "small_hero_small_want",
    title: "Small hero, small felt want",
    rule: "Open with the hero doing a small ordinary thing. Give them ONE tiny, specific want or worry on page 1 — never a grand quest. Ex: 'Dylan the young blue dragon was lonely.' 'Arnold Ant is always angry.' Simplicity is the point.",
    lifts: ["age_appropriateness", "emotional_payoff", "language_level"],
  },
  {
    id: "concrete_helper_or_ritual",
    title: "One concrete helper, object, or ritual carries the theme",
    rule: "The lesson must be embodied by ONE tangible thing a child can point at: a bottle of 'Anger Medicine', a Tooth Fairy's health card, Abe's halter, Dylan's white surrender flag. Never deliver the theme as narration or a speech — put it in a physical object or repeated action.",
    lifts: ["parent_buyer_value", "reread_value", "emotional_payoff"],
  },
  {
    id: "three_escalating_tries",
    title: "Three escalating tries in the middle",
    rule: "The middle spreads (roughly spreads 4–10) are three tries at solving the problem, each bigger or bolder than the last. Try 1 fails softly, try 2 fails harder, try 3 works — or reveals what the hero really needed. This is the picture-book heartbeat.",
    lifts: ["story_coherence", "reread_value", "emotional_payoff"],
  },
  {
    id: "post_page_turn_reveals",
    title: "Big surprises land POST-page-turn",
    rule: "The page turn is the pacing engine of a picture book. Plan every big laugh, reveal, or emotional beat so the surprise happens AFTER the reader turns the page. End odd-numbered spreads on a question, gap, or set-up; deliver the payoff on the following spread.",
    lifts: ["reread_value", "emotional_payoff", "story_coherence"],
  },
  {
    id: "gentle_worry_never_terror",
    title: "Gentle worry, never terror",
    rule: "Peril is real but soft. Sally is stuck in a small cave, not lost forever. Arnold's shouting scares 'a whole crowd' but nobody is hurt. Use worry a 4-year-old can survive and see resolved in 3 pages.",
    lifts: ["age_appropriateness", "emotional_payoff"],
  },
  {
    id: "implicit_moral_via_action",
    title: "Implicit moral through the hero's own action",
    rule: "Never let a wise adult or narrator say the lesson. The hero performs it. If a sentence in the manuscript could hang on a classroom poster, delete it and replace it with a scene that shows the same idea through consequence.",
    lifts: ["parent_buyer_value", "emotional_payoff", "reread_value"],
  },
  {
    id: "final_spread_warm_payoff",
    title: "Final spread = warm, specific, IMAGE-based payoff of the parent hook",
    rule: "The last page must be a warm, quiet, sensory image — a hug, a shared meal, the once-scary thing now cozy, a completed ritual continuing forever after — that lands the developmental theme without stating it. No 'and they all learned…' sentence. Ever.",
    lifts: ["parent_buyer_value", "emotional_payoff", "final_concept_score"],
  },
  {
    id: "chantable_or_ritual_repetition",
    title: "Chantable refrain OR ritual sentence a child will echo",
    rule: "Include either (a) a 4–8 word chantable refrain repeated 3–4× with slight evolution each time (escalating stakes or a small twist), OR (b) a ritual sentence pattern the child will predict and say aloud. Repetition is the child's contract with the book and is the #1 predictor of demand for re-reads.",
    lifts: ["reread_value", "language_level"],
  },
  {
    id: "reveal_or_ritual_ending",
    title: "Ending is a small reveal or a completed ritual — never a moral speech",
    rule: "Pick ONE of two proven endings: (1) SMALL REVEAL — a twist recontextualizes the book (the 'medicine' was water; the truth was inside the hero all along); or (2) COMPLETED RITUAL — the promised routine finally happens and continues forever after. Both drive re-reads.",
    lifts: ["reread_value", "emotional_payoff", "parent_buyer_value"],
  },
  {
    id: "sensory_read_aloud_voice",
    title: "Sensory, read-aloud voice a parent enjoys performing",
    rule: "Short sentences (≤12 words). Concrete verbs. Named characters. Sound words ('Heave...!', 'Yay!'). Read every sentence aloud in your head — if a parent's mouth won't enjoy it, rewrite it. Rhythm and musicality are non-negotiable for the 4–6 band.",
    lifts: ["language_level", "age_appropriateness", "reread_value"],
  },
  {
    id: "hidden_visual_details",
    title: "Plant hidden visual details for re-read hunts",
    rule: "Every 2–3 spreads, note in the illustrator brief a tiny visual detail (a mouse in the corner, the refrain word hidden on a sign, the callback object appearing early) that rewards the child on the second and third read. Story text does not point at them.",
    lifts: ["reread_value", "parent_buyer_value"],
  },
  {
    id: "one_theme_only",
    title: "Exactly ONE theme",
    rule: "A single book teaches, feels, and pays off ONE developmental idea. Two themes = zero themes; the parent-facing pitch blurs and the emotional arc dilutes. If the outline is trying to teach 'kindness AND courage AND sharing', pick the strongest one and cut the others.",
    lifts: ["parent_buyer_value", "emotional_payoff", "final_concept_score"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// AGE-BAND SPECS — production shape per band.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgeBandSpec {
  id: string;             // e.g. '0-3', '4-6', '5-7', '7-9'
  label: string;
  wordCount: string;
  spec: string;
}

export const AGE_BAND_SPECS: AgeBandSpec[] = [
  {
    id: '0-3',
    label: 'Board-book (ages 0–3)',
    wordCount: '≤100–200 words total',
    spec: `Board-book style. ONE concept only (colors, animals, routines, body parts, family). No plot complexity. Naming / pointing / touch interactivity ("Where is baby's nose?"). Strong rhythm or rhyme. Sensory language. Themes of comfort and routine. Sturdy repetition. No conflict beyond a tiny surprise.`,
  },
  {
    id: '4-6',
    label: 'Picture book (ages 4–6) — our current product · SQUARE 8.5x8.5 in, 32–40 pages',
    wordCount: '500–800 words MAX across 28–36 story pages (1 illustration + 1–3 sentences per page)',
    spec: `Square 8.5x8.5 in trim, 32–40 pages total (title + copyright + 28–36 story pages + closing). ONE full-color illustration on EVERY page, ONE scene per page. Hard cap 800 words, 15–30 words per page (1–3 short sentences). THREE-ACT SHAPE spread across 28+ beats — brief setup (pages 1–4) → problem + THREE escalating tries (middle) → warm resolution (final 3–6 pages). THE HERO SOLVES IT THEMSELVES (rule hero_solves_it_themselves). One chantable refrain repeated 4–6× across the book, ideally evolving slightly each time. Plan every big surprise as a POST-PAGE-TURN reveal — end odd pages on a set-up, deliver the payoff on the next page. Humor that works at 4–6: slapstick, absurd escalation, wordplay, the adult being wrong while the child is right. ONE theme only. Every sentence must be fun in a parent's mouth (read it aloud mentally as you write). No stated moral.`,
  },
  {
    id: '5-7',
    label: 'Early reader (ages 5–7)',
    wordCount: '200–1,500 words',
    spec: `Very short sentences. High-frequency, decodable vocabulary. Repetition builds decoding confidence — repeat sentence patterns and short refrains. Short scene per page. The child should feel triumphant reading a whole book alone.`,
  },
  {
    id: '7-9',
    label: 'Chapter book (ages 7–9)',
    wordCount: '4,000–15,000 words',
    spec: `Short chapters (~500–1,500 words each). School / friendship / fitting-in themes. Real character-growth arc. Occasional black-and-white illustrations to break up text. Give the hero a specific flaw they grow past.`,
  },
];

export function ageBandSpec(ageBand: string | undefined | null): AgeBandSpec {
  const key = String(ageBand ?? '4-6');
  return AGE_BAND_SPECS.find(s => s.id === key) ?? AGE_BAND_SPECS.find(s => s.id === '4-6')!;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBOOKS — deep guidance per QC dimension that keeps scoring low.
// ─────────────────────────────────────────────────────────────────────────────

export const PARENT_BUYER_VALUE_PLAYBOOK = `PARENT_BUYER_VALUE playbook (this is how you lift buyer=80 → 85+):

WHY IT MATTERS. Nielsen research: 58% of parents prioritize educational value, 41% prioritize fun. The single biggest purchase trigger is "my child asked for it again." That means the book must produce two effects at once: a hook a CHILD demands (character + refrain + humor + reread), and a theme a PARENT recognizes as growth.

TITLE + COVER + DESCRIPTION LEGIBILITY (scanned in seconds).
The title must telegraph BOTH the fun AND the developmental theme. A parent should not need the description to guess what their child gains.
  Bad: "The Wobbly Wheel's Whodunit" — a parent cannot tell what this teaches.
  Good template: "Llama Llama Misses Mama" = instantly readable as a separation-anxiety book with a lovable hero.
  Test the title: can a stranger name the developmental theme in ≤4 seconds? If not, retitle.

DEVELOPMENTAL THEME MENU — pick exactly ONE per book (from PARENT_HOOK_MENU) and land it on the final spread as an image, not a statement.

CHILD-APPEAL HOOKS (produce the "again!" demand parents notice).
  1. A hero a child latches onto — one memorable trait, one repeatable gesture.
  2. A refrain the child chants aloud within one reading (rule chantable_or_ritual_repetition).
  3. Humor the child re-tells at breakfast (slapstick, absurd escalation, the adult being wrong).

SERIES POTENTIAL raises perceived value.
Recurring hero + a repeatable premise formula ("Hero + [new small worry] each book") signals to parents that this is a keeper, not a one-off.

ANTI-PATTERN: a lesson stated in narration ("And Arnold learned that anger is not the answer"). Delete every such sentence. Replace with a scene where the hero does the thing.`;

export const EMOTIONAL_PAYOFF_PLAYBOOK = `EMOTIONAL_PAYOFF playbook:

PICK ONE UNIVERSAL EMOTION per book (longing, frustration, fear, pride, love). Name it before you outline. Every scene either builds or releases that one emotion.

EMOTIONAL REHEARSAL. A picture book is a safe container in which a child watches a hero survive a feeling they themselves have felt. The story succeeds when the child recognises the feeling early, feels the tension midway, and feels the release on the final spread.

FINAL SPREAD = A WARM SPECIFIC IMAGE, not an abstract statement.
  ✓ A hug on the doorstep. A shared meal. The once-scary thing now cozy. A ritual continuing.
  ✗ "And they knew they were loved."
  ✗ "And that is how Arnold learned about kindness."

DEEPLY PERSONAL SPECIFICS RESONATE UNIVERSALLY (Caldecott / Kate Greenaway award-committee criterion). Concrete sensory detail ("mummy dragon's pea and toad soup was still warm on the stove") beats abstract sentiment ("mummy loved him") every time.

HERO SOLVES IT (see rule hero_solves_it_themselves). The release lands emotionally only when the child sees the HERO make the brave choice.`;

export const REREAD_VALUE_PLAYBOOK = `REREAD_VALUE playbook:

RESEARCH BASIS. Children learn more vocabulary from repeated readings of the same book than from a wider variety of books. Predictability is WHY they beg to re-read — they know what is coming and they want to say it out loud.

THREE MECHANICS that produce reread demand — build in at least TWO:

1. PREDICT-AND-PARTICIPATE REFRAIN. A 4–8 word chant, repeated 3–4×, ideally evolving slightly each time ("bigger and bigger", "louder and louder", or a small variant on the last word). The child will finish the sentence for the parent by read #2.

2. CUMULATIVE OR PATTERN STRUCTURE. Three tries, each bigger than the last (see rule three_escalating_tries). The child predicts the pattern and delights when it holds.

3. HIDDEN VISUAL DETAILS. Plant tiny recurring details in the illustration briefs — a mouse in every corner, the callback object appearing early, the refrain word hidden on a sign. The child hunts them on rereads. Do not point at them in the story text.

RHYTHM SO STRONG THE PARENT ENJOYS PERFORMING IT. If the parent enjoys reading it aloud, the parent volunteers for read #2 without being asked. This is a story-craft choice, not a marketing one.`;

export const ANTI_PREACHY_PLAYBOOK = `ANTI-PREACHY rules (protect age_fit AND parent_buyer_value simultaneously):

RULE 1. STORY FIRST, LESSON NEVER STATED. If a sentence could hang on a classroom poster, rewrite it as a scene with a consequence. "Sharing is caring" is a poster; a scene where the hero shares and gets an unexpected warm reaction is a story.

RULE 2. CHILD-SHAPED FLAW. The hero has a flaw a real 4–6-year-old has — messy, impatient, scared, jealous, bossy, forgetful. The lesson emerges from the hero's OWN choices facing that flaw, not from an adult correcting them.

RULE 3. EXACTLY ONE THEME. Two themes = zero themes. If the outline is trying to teach 'kindness AND courage AND sharing', pick the strongest and cut the others.

RULE 4. NO NARRATED SUMMARY AT THE END. The book ends on an IMAGE, not on a sentence that explains what the reader was supposed to learn.`;

export const SELLABILITY_META_PLAYBOOK = `SELLABILITY metadata (storefront listing — how the book converts a scanning parent):

DESCRIPTION FORMULA (3 short lines, in this order):
  Line 1 — HOOK QUESTION a parent recognises: "Does your little one ever…?" / "Is bedtime a battle in your house?"
  Line 2 — WHAT HAPPENS in the book (one sentence, name the hero and the problem).
  Line 3 — WHY IT HELPS + AGE + THEME: "Perfect for ages 4–6 · themes: [theme]".

NATURAL-LANGUAGE KEYWORDS (store in storefront_meta.keywords[]): phrases parents actually search — "kids book about sharing age 4", "picture book about big feelings", "toddler book about starting school". Not SEO strings.

PRICE ANCHOR: around $4.99 for a digital picture book keeps it in impulse-buy range.

TITLE + COVER already covered under PARENT_BUYER_VALUE playbook — the title itself is 80% of the sellability job.`;

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSION SKILL — the pipeline's ad-creative + storefront playbook.
// Every artifact exists to convert a parent landing from a paid ad. Injected
// into cover generation, title/hook, description, and the frontend.
// ─────────────────────────────────────────────────────────────────────────────

export const CONVERSION_COVER_SKILL = `CONVERSION_COVER — the cover is an AD CREATIVE first, a book cover second.

RESEARCH: parents give a cover <1s of eye time in a feed/search grid. The cover must pass the THUMBNAIL TEST: at 100×160px the title is readable AND the subject is identifiable.

HARD RULES for the AI illustration prompt:
1. ONE hero character only, filling 40–60% of the vertical, facing camera, MAKING EYE CONTACT, expressive readable emotion (joy / surprise / determination — never neutral). Multi-character scenes read as noise at thumbnail size.
2. BRIGHT, HIGH-CONTRAST palette that reads as a kids-book genre signal — saturated warm/primary hues with clean shape blocking. No muted / dusty / smoky palettes. No dark backgrounds behind where the title will sit.
3. Background must contrast HARD with the intended title colour so the title never fights the art.
4. Leave a clean UPPER THIRD zone with soft shape / open sky / uncluttered colour — the app will render the title there.
5. Cover must telegraph the SAME developmental theme as the title. If the parent-hook is "first-day fears", the hero must visibly be nervous facing a threshold (schoolhouse door, playground gate) — not a random unrelated scene.
6. Less busy = better. ONE hero, ONE prop, ONE mood.

HARD BANS: no second character crowding the frame, no dark/smoky backgrounds, no tiny hero (hero <30% of vertical fails), no back-turned hero, no neutral / cool expressions, no photorealism, no complex parallax scenes.

TITLE TREATMENT (composed by app, not by AI):
- Chunky, friendly, hand-lettered-feel display face (Fredoka / Baloo / equivalent). 68% of bestseller covers use rounded chunky sans. NEVER thin/geometric.
- Title occupies 40–60% of cover HEIGHT, placed in the UPPER THIRD (bottom-placed titles vanish under storefront UI overlays).
- Max 3 lines, wrapped for balance. Heavy stroke outline for legibility against any hero-scene background.
- One accent colour, chosen from the visual bible palette, that contrasts with the sky/upper-third pixels beneath it.`;

export const CONVERSION_COVER_LETTERING_SKILL = `CONVERSION_COVER_LETTERING — the title on a kids picture-book cover is DESIGNED HAND-LETTERED ARTWORK integrated into the illustration, never a plain system-font stamp.

REFERENCE STANDARD: premium published picture books (e.g. "Giraffes Can't Dance", "This Moose Belongs to Me", "My Quiet Imagination", Plan For Kids titles). Their titles feel commissioned, painted, part of the scene.

HARD RULES for the image model (inject these VERBATIM into the cover generation prompt):
1. The AI MUST render the title text "<EXACT TITLE>" ON the cover as hand-lettered artwork — commissioned lettering, drawn in the SAME medium and style as the illustration (watercolor brush strokes, chunky painted letters, crayon/gouache texture), lit by the same light, sharing the palette.
2. Letterforms are PLAYFUL and ORGANIC: bouncing baseline (letters dance up and down), size variation between words (the fun/emotive word is largest), gentle arc or curve following the composition. NEVER a straight rigid line of type. NEVER a system font. NEVER Times/Arial/Helvetica look.
3. READABILITY ARMOR — one of: thick contrasting outline (2-4% of letter height) around every glyph, OR soft drop shadow, OR a subtle painted banner / ribbon / wooden-sign / cloud shape behind the lettering. So the title reads clearly at 100×160px thumbnail size on a busy illustration.
4. COLOUR: title uses the 1–2 highest-contrast colours from the scene palette — cream/white letters over dark areas, deep saturated colour over light sky. Must POP against its background zone but still harmonize with the scene.
5. INTEGRATION: a character or prop can gently overlap the bottom of ONE letter, or the lettering can arc around the hero — makes it feel hand-made. Keep overlap subtle so no letter becomes ambiguous or unreadable.
6. PLACEMENT: upper third of the cover, occupying 40–60% of cover WIDTH, hero character below or beside, hero making eye contact with camera.
7. SPELLING IS MANDATORY. Every letter of the title must be rendered correctly, in reading order, no missing/duplicated/mangled letters. Kern the lettering with confident spacing.
8. Thai-market bonus (for Thai editions only): bubbly rounded letterforms with thick white outlines + small decorative stars/sparkles.

HARD BANS: no plain system font stamped on top of art, no thin geometric type, no all-caps rigid line of type, no misspelled or gibberish lettering, no lettering that vanishes into the background, no lettering that covers the hero's face.

REPAIR LADDER when lettering QC fails:
- attempt 1 (misspelled / hard to read) → regenerate cover, simplify: shorter effective title zone, BIGGER letters, fewer decorative elements, thicker outline, plainer background behind the title zone.
- attempt 2 (still misspelled) → regenerate once more with the strongest simplification: single-line arc, one accent colour, painted banner behind the lettering.
- LAST RESORT (still failing after simplification): composite a chunky rounded hand-lettered-feel webfont (Fredoka / Baloo / equivalent) with heavy stroke outline over the AI background — never ship a misspelled cover.`;

export const CONVERSION_TITLE_HOOK_SKILL = `CONVERSION_TITLE_HOOK — the title IS the ad headline.

TITLE FORMULA: [child-appealing fun element] + [parent-legible developmental benefit], ≤6 words, chantable.
   ✓ "Luna's Big Sharing Day" — fun (Luna, Big Day) + parent benefit (Sharing).
   ✓ "Bruno Braves the New School" — fun (Bruno Braves) + parent benefit (first-day fears).
   ✗ "The Wobbly Wheel's Whodunit" — no parent-legible benefit; parent cannot guess theme.
   ✗ "A Very Curious Adventure" — no theme, no fun-specific hero.

DUAL TEST every title must pass:
1. A parent who reads ONLY the title guesses the developmental theme within 2 seconds.
2. A 4-year-old can and WANTS to say the title out loud for fun.
If either test fails, retitle.

HOOK LINE (first line of description AND the future ad headline):
- Must be a question or scenario the parent instantly recognizes from THEIR OWN LIFE.
- Emotional recognition beats cleverness.
   ✓ "Does bedtime turn into a battle at your house?"
   ✓ "Is your little one nervous about their first day of school?"
   ✗ "Meet Bruno, a curious young owl who loves adventures." (plot summary, not a hook)
- ONE hook = ONE pain/desire. Never stack.

MESSAGE MATCH: the same theme promise must repeat across ad → cover → title → hook → description. 90%+ message match converts ~2.3x better.`;

export const CONVERSION_DESCRIPTION_SKILL = `CONVERSION_DESCRIPTION — the storefront paragraph exists to convert, not to summarize.

STRUCTURE (in this exact order, short lines, scannable):

1. HOOK (1 line): the recognizable parent moment. Question or scenario. Emotional recognition.
   Example: "Does your little one melt down when plans suddenly change?"

2. STORY PROMISE (2–3 short lines): what the CHILD experiences, using concrete imagery from the ACTUAL book — the refrain, the funniest moment, the callback object. NEVER a plot summary written like a book report.
   Example: "Meet Bruno, a brave little owl. When his big feelings bubble up, Bruno chants his magic four words — and the whole forest joins in."

3. OUTCOME (1 line): what the PARENT gets — the felt benefit at home.
   Example: "Giggles at bedtime, and an easier way to talk about big feelings."

4. SPECS LINE (1 line, dot-separated):
   "Perfect for ages 4-6 · [theme] · read-aloud ~7 min · [XX] pages"

BULLET LIST (optional, 2–4 items): benefit-led, not feature-led.
   ✓ "A chantable refrain your child will echo by page 3"
   ✓ "A warm ending that names big feelings without a lecture"
   ✗ "24 illustrated pages" (feature, not benefit)

EMOTIONAL TRIGGERS that work on parents: care/protection, pride in the child's growth, shared-moment nostalgia. Emotionally engaged buyers are 3× more likely to purchase and recommend.

FIELDS to populate on ebooks_kids:
- selling_hook (eyebrow, ≤14 words) — the parent recognition line
- short_hook — same, shorter (≤12 words) for cards
- product_description — full block above
- shopping_card_description — HOOK + STORY_PROMISE lines only, ≤60 words
- preview_blurb — one warm line hinting at the payoff
- benefit_bullets[] — 3–4 benefit-led bullets

storefront_meta MUST include \`ad_promise\`: { theme, hook_line, primary_benefit } so future ad campaigns reuse the exact same message-matched copy.`;

export const CONVERSION_PRODUCT_PAGE_SKILL = `CONVERSION_PRODUCT_PAGE — the storefront page + kids grid.

MOBILE-FIRST (73% of ecom traffic is mobile). Page must load <3s; every extra second costs ~7% conversion.

ABOVE THE FOLD on mobile: cover · title · hook line · price · primary CTA — no scrolling needed to buy.

PROOF: show 2–3 preview spreads (the funniest/warmest interior pages). For books, "look inside" is the single strongest proof element.

NEAR THE CTA (badge row): age band · theme · read-aloud time (~X min).

PRICE ANCHOR: ~$4.99 (impulse-buy range).

SOCIAL PROOF: star rating + review count once reviews exist. Until then show a "New release" badge. Never fake reviews. Never fake scarcity ("only 3 left" for a digital file).

MESSAGE MATCH: the ad, cover, title, hook and landing page all repeat the same theme promise. Store each book's ad_promise in storefront_meta so paid campaigns reuse it verbatim.`;

// ─────────────────────────────────────────────────────────────────────────────
// EXEMPLAR PATTERNS — short paraphrases from the reference books.
// ─────────────────────────────────────────────────────────────────────────────

export const EXEMPLAR_PATTERNS = {
  opening_formula: [
    "Hero + tiny felt want in ≤3 sentences. Ex (paraphrased): 'Arnold Ant is always angry. He shouts, he screams, and the other ants doubt him.' — hero, problem, and stakes in 20 words.",
    "Small ordinary scene + nudge from a caring adult. Ex (paraphrased): 'Dylan the young dragon flew all over the mountains looking for something to do. When he was hungry he went home to Mummy Dragon.' — the world feels safe before the loneliness lands.",
  ],
  refrain_or_ritual_formula: [
    "Short line the child will chant. Ex: 'Ready or not, here I come!' — repeated across pages, escalated by context.",
    "Numbered ritual card embedded in the story: 1. Eat healthy. 2. Cut down on sweets. 3. Brush twice a day… — turns the moral into a recitable object.",
  ],
  climax_payoff_formula: [
    "Hero tries the small brave thing themselves. Ex (paraphrased): 'Anytime Arnold felt anger rising, he sipped the medicine and shut his eyes. When the ten minutes passed, he could barely remember why he was angry.' — child sees the tool actually work.",
    "Hero offers a peace gesture that flips the situation. Ex (paraphrased): 'Dylan tucked a white handkerchief into his gill, held up a surrender flag, and said softly, I just want to play.' — the visual gesture IS the resolution.",
  ],
  closing_ritual_formula: [
    "REVEAL close (paraphrased): 'I did not cure you, Ant. There was only water in the bottle. You calmed yourself.' — the twist reframes the whole book.",
    "RITUAL close (paraphrased): 'From that day, Dylan and the playground children were friends, and every day Dylan gave them the best playground ride ever.' — a warm forever-after that lands the theme.",
    "FRAME close (paraphrased): 'A long time has passed and now I help my friend meet her new service dog. Then I become a good friend for a good family. You really couldn't ask for more.' — hero passes the gift forward.",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION — build the block that goes into any prompt.
// ─────────────────────────────────────────────────────────────────────────────

function craftRulesText(): string {
  return CRAFT_RULES.map((r, i) =>
    `${i + 1}. [${r.id}] ${r.title}\n   ${r.rule}\n   → lifts: ${r.lifts.join(", ")}`
  ).join("\n");
}

function hooksText(): string {
  return PARENT_HOOK_MENU.map(h => `   - ${h}`).join("\n");
}

function exemplarsText(): string {
  return [
    'EXEMPLAR OPENING FORMULAS:',
    ...EXEMPLAR_PATTERNS.opening_formula.map(s => `   • ${s}`),
    '',
    'EXEMPLAR REFRAIN / RITUAL FORMULAS:',
    ...EXEMPLAR_PATTERNS.refrain_or_ritual_formula.map(s => `   • ${s}`),
    '',
    'EXEMPLAR CLIMAX PAYOFF FORMULAS:',
    ...EXEMPLAR_PATTERNS.climax_payoff_formula.map(s => `   • ${s}`),
    '',
    'EXEMPLAR CLOSING FORMULAS (choose ONE — reveal, ritual, or frame):',
    ...EXEMPLAR_PATTERNS.closing_ritual_formula.map(s => `   • ${s}`),
  ].join('\n');
}

/**
 * Synchronous fallback / bundled block. Prefer `loadStoryCraftBlock(db, ageBand)`
 * so runtime edits from `kids-skill-learner` are picked up.
 */
export function storyCraftBlock(ageBand?: string | null): string {
  const spec = ageBandSpec(ageBand);
  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STORY CRAFT SKILL — distilled from published picture books + editorial research
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED PARENT HOOK — pick ONE from this menu FIRST, before anything else:
${hooksText()}
Every beat of the story must serve this hook. The final spread must land it
as a warm, specific image (rule final_spread_warm_payoff).

AGE-BAND SPEC — ${spec.label} · ${spec.wordCount}
${spec.spec}

CRAFT RULES (each is tied to the QC dimension it lifts — follow ALL):
${craftRulesText()}

${PARENT_BUYER_VALUE_PLAYBOOK}

${EMOTIONAL_PAYOFF_PLAYBOOK}

${REREAD_VALUE_PLAYBOOK}

${ANTI_PREACHY_PLAYBOOK}

${SELLABILITY_META_PLAYBOOK}

${exemplarsText()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-BACKED LOADER — reads latest version of every skill section from
// pipeline_skills so the auto skill-learner can improve the playbook. Falls
// back to the bundled `storyCraftBlock()` on any read error.
// ─────────────────────────────────────────────────────────────────────────────

export interface DbSkillRow {
  skill_key: string;
  version: number;
  content_md: string;
  sort_index: number;
  age_band: string | null;
  source: 'seed' | 'learned';
  target_dimension: string | null;
}

/**
 * Fetch the latest version of every skill section, filter to (all-bands ∪
 * requested age band), sort by sort_index, and concat into a single block.
 * On any failure, returns the bundled synchronous block so prompts are never
 * empty.
 */
export async function loadStoryCraftBlock(
  db: SupabaseClient,
  ageBand?: string | null,
): Promise<string> {
  try {
    const { data, error } = await db
      .from('pipeline_skills')
      .select('skill_key, version, content_md, sort_index, age_band, source, target_dimension')
      .order('skill_key', { ascending: true })
      .order('version', { ascending: false });
    if (error || !Array.isArray(data) || data.length === 0) {
      return storyCraftBlock(ageBand);
    }
    // Latest version per skill_key.
    const latest = new Map<string, DbSkillRow>();
    for (const row of data as DbSkillRow[]) {
      if (!latest.has(row.skill_key)) latest.set(row.skill_key, row);
    }
    // Filter by age band: keep rows with age_band = null (universal) or matching.
    const wanted = String(ageBand ?? '4-6');
    const rows = Array.from(latest.values())
      .filter(r => r.age_band === null || r.age_band === wanted)
      .sort((a, b) => a.sort_index - b.sort_index);
    if (rows.length === 0) return storyCraftBlock(ageBand);

    const header = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STORY CRAFT SKILL (live from pipeline_skills · ${rows.filter(r => r.source === 'learned').length} learned upgrades applied)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    const body = rows.map(r => r.content_md).join('\n\n');
    return `${header}\n\n${body}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  } catch (_e) {
    return storyCraftBlock(ageBand);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION → CRAFT RULE map (used by the story-gate reviser for surgical
// per-dimension repair guidance).
// ─────────────────────────────────────────────────────────────────────────────

export const DIMENSION_TO_RULES: Record<string, string[]> = {
  parent_buyer_value: ["parent_hook_anchor", "hero_solves_it_themselves", "concrete_helper_or_ritual", "final_spread_warm_payoff", "implicit_moral_via_action", "one_theme_only"],
  emotional_payoff: ["hero_solves_it_themselves", "small_hero_small_want", "final_spread_warm_payoff", "implicit_moral_via_action", "post_page_turn_reveals"],
  reread_value: ["chantable_or_ritual_repetition", "reveal_or_ritual_ending", "three_escalating_tries", "post_page_turn_reveals", "hidden_visual_details", "concrete_helper_or_ritual"],
  language_level: ["sensory_read_aloud_voice", "chantable_or_ritual_repetition"],
  age_appropriateness: ["small_hero_small_want", "gentle_worry_never_terror", "one_theme_only"],
  story_coherence: ["three_escalating_tries", "post_page_turn_reveals"],
  generic_risk: ["parent_hook_anchor", "concrete_helper_or_ritual", "reveal_or_ritual_ending"],
};

// Playbook a failing dimension should cite in the reviser prompt.
export const DIMENSION_TO_PLAYBOOK: Record<string, string> = {
  parent_buyer_value: PARENT_BUYER_VALUE_PLAYBOOK,
  emotional_payoff: EMOTIONAL_PAYOFF_PLAYBOOK,
  reread_value: REREAD_VALUE_PLAYBOOK,
};

const DIMENSION_TO_SKILL_KEY: Record<string, string> = {
  parent_buyer_value: 'playbook_parent_buyer_value',
  emotional_payoff: 'playbook_emotional_payoff',
  reread_value: 'playbook_reread_value',
  language_level: 'craft_rules',
  age_appropriateness: 'anti_preachy',
  story_coherence: 'craft_rules',
  generic_risk: 'craft_rules',
};

export function craftRulesForDimension(dimension: string): CraftRule[] {
  const ids = DIMENSION_TO_RULES[dimension] ?? [];
  return CRAFT_RULES.filter(r => ids.includes(r.id));
}

export function repairGuidanceForDimension(dimension: string): string {
  const rules = craftRulesForDimension(dimension);
  const rulesBlock = rules.length
    ? rules.map(r => `  · [${r.id}] ${r.title} — ${r.rule}`).join("\n")
    : '';
  const playbook = DIMENSION_TO_PLAYBOOK[dimension];
  return playbook ? `${rulesBlock}\n  ─── DIMENSION PLAYBOOK ───\n${playbook}` : rulesBlock;
}

export async function loadRepairGuidanceForDimension(
  db: SupabaseClient,
  dimension: string,
  ageBand?: string | null,
): Promise<string> {
  const rules = craftRulesForDimension(dimension);
  const rulesBlock = rules.length
    ? rules.map(r => `  · [${r.id}] ${r.title} — ${r.rule}`).join("\n")
    : '';
  const skillKey = DIMENSION_TO_SKILL_KEY[dimension];
  if (!skillKey) return repairGuidanceForDimension(dimension);
  try {
    const wanted = String(ageBand ?? '4-6');
    const { data, error } = await db
      .from('pipeline_skills')
      .select('content_md, source, version, age_band')
      .eq('skill_key', skillKey)
      .or(`age_band.is.null,age_band.eq.${wanted}`)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.content_md) return repairGuidanceForDimension(dimension);
    return `${rulesBlock}\n  ─── LIVE DIMENSION PLAYBOOK (${skillKey} v${data.version}${data.source === 'learned' ? ' · learned' : ''}) ───\n${data.content_md}`;
  } catch (_e) {
    return repairGuidanceForDimension(dimension);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED ROWS — used by the migration + by any bootstrap tool. Keep in sync
// with the migration so the DB and this constant produce the same block.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedRow {
  skill_key: string;
  sort_index: number;
  age_band: string | null;
  target_dimension: string | null;
  content_md: string;
}

export function seedRows(): SeedRow[] {
  const rows: SeedRow[] = [
    {
      skill_key: 'parent_hook_menu',
      sort_index: 10,
      age_band: null,
      target_dimension: 'parent_buyer_value',
      content_md: `REQUIRED PARENT HOOK — pick ONE from this menu FIRST, before anything else:\n${hooksText()}\nEvery beat of the story must serve this hook. The final spread must land it as a warm, specific image (rule final_spread_warm_payoff).`,
    },
    {
      skill_key: 'craft_rules',
      sort_index: 30,
      age_band: null,
      target_dimension: null,
      content_md: `CRAFT RULES (each is tied to the QC dimension it lifts — follow ALL):\n${craftRulesText()}`,
    },
    {
      skill_key: 'playbook_parent_buyer_value',
      sort_index: 40,
      age_band: null,
      target_dimension: 'parent_buyer_value',
      content_md: PARENT_BUYER_VALUE_PLAYBOOK,
    },
    {
      skill_key: 'playbook_emotional_payoff',
      sort_index: 50,
      age_band: null,
      target_dimension: 'emotional_payoff',
      content_md: EMOTIONAL_PAYOFF_PLAYBOOK,
    },
    {
      skill_key: 'playbook_reread_value',
      sort_index: 60,
      age_band: null,
      target_dimension: 'reread_value',
      content_md: REREAD_VALUE_PLAYBOOK,
    },
    {
      skill_key: 'anti_preachy',
      sort_index: 70,
      age_band: null,
      target_dimension: 'parent_buyer_value',
      content_md: ANTI_PREACHY_PLAYBOOK,
    },
    {
      skill_key: 'sellability_meta',
      sort_index: 80,
      age_band: null,
      target_dimension: 'parent_buyer_value',
      content_md: SELLABILITY_META_PLAYBOOK,
    },
    {
      skill_key: 'exemplar_patterns',
      sort_index: 90,
      age_band: null,
      target_dimension: null,
      content_md: exemplarsText(),
    },
    {
      skill_key: 'conversion_cover',
      sort_index: 100,
      age_band: null,
      target_dimension: 'cover_conversion',
      content_md: CONVERSION_COVER_SKILL,
    },
    {
      skill_key: 'conversion_cover_lettering',
      sort_index: 105,
      age_band: null,
      target_dimension: 'cover_conversion',
      content_md: CONVERSION_COVER_LETTERING_SKILL,
    },
    {
      skill_key: 'conversion_title_hook',
      sort_index: 110,
      age_band: null,
      target_dimension: 'commercial_metadata',
      content_md: CONVERSION_TITLE_HOOK_SKILL,
    },
    {
      skill_key: 'conversion_description',
      sort_index: 120,
      age_band: null,
      target_dimension: 'commercial_metadata',
      content_md: CONVERSION_DESCRIPTION_SKILL,
    },
    {
      skill_key: 'conversion_product_page',
      sort_index: 130,
      age_band: null,
      target_dimension: 'commercial_metadata',
      content_md: CONVERSION_PRODUCT_PAGE_SKILL,
    },
  ];
  for (const s of AGE_BAND_SPECS) {
    rows.push({
      skill_key: `age_band_spec_${s.id}`,
      sort_index: 20,
      age_band: s.id,
      target_dimension: 'age_appropriateness',
      content_md: `AGE-BAND SPEC — ${s.label} · ${s.wordCount}\n${s.spec}`,
    });
  }
  return rows;
}
