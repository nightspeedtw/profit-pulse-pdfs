// LLM-based story/age/reread judge for kids picture books.
// Reads the actual manuscript + page plan and returns evidence-backed scores.
//
// v2 CALIBRATION (2026-07-13): the earlier prompt never told the model the
// polarity of `generic_story_risk_score` or what "generic" means, so the model
// clustered mid-range (60-75) for every premise regardless of actual
// distinctiveness. This version adds explicit polarity, rubric anchors,
// familiar-object non-penalty rules, subscores, and few-shot examples.

import type { RawFinding } from "./pdf-preflight.ts";
import { logAiCost, costDb } from "./cost-log.ts";
import { parseModelJson } from "./model-json.ts";
import { geminiDirectChat, hasGeminiDirect } from "./gemini-direct.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const JUDGE_MODEL = "google/gemini-2.5-flash";

export interface StoryReport {
  age_appropriateness_score: number;
  story_coherence_score: number;
  emotional_payoff_score: number;
  reread_value_score: number;
  language_level_score: number;
  page_turn_rhythm_score: number;
  parent_buyer_value_score: number;
  // Subscores that feed generic_story_risk_score (higher = more specific, EXCEPT trope_dependency where higher = worse).
  premise_specificity_score: number;
  story_engine_specificity_score: number;
  visual_hook_specificity_score: number;
  retitle_resistance_score: number;
  trope_dependency_score: number;
  generic_story_risk_score: number; // 0 = distinctive/unique, 100 = extremely generic
  story_qc_passed: boolean;
  evidence: Array<{ dimension: string; quote?: string; page?: number; reason: string; repair_action: string }>;
  generic_risk_analysis?: {
    distinctive_details: string[];
    generic_details: string[];
    could_be_retitled: boolean;
    specific_page_turn_moments: string[];
  };
  reread_evidence?: {
    refrain_text: string;
    refrain_count: number;
    participation_beats: string[];
    hidden_thread: string;
    callback_ending: boolean;
  };
  parent_buyer_evidence?: {
    developmental_theme_one_liner: string;
    lesson_is_shown_not_told: boolean;
    child_has_agency: boolean;
    moralizing_lines: string[];
  };
  score_adjustments?: Array<{ dimension: string; from: number; to: number; reason: string }>;
  judge_version?: string;
  computed_at: string;
}

export interface RunStoryJudgeOpts {
  title: string;
  subtitle?: string | null;
  ageBand?: string | null;
  manuscript_md: string;
  page_texts?: string[];
  ebook_id?: string;
}

const JUDGE_VERSION = "v3-2026-07-14";

const SYSTEM = `You are a strict but FAIR children's picture book editor and buyer.
You judge a real manuscript, not marketing metadata.
Assign integer 0-100 scores. Provide EVIDENCE for every dimension: a short quote and/or page number and a reason.
Never give a score without evidence. If you cannot find evidence, score low and explain what is missing.
Return ONLY JSON. No markdown fences.

CRITICAL SCORING RULES:

1. POLARITY of generic_story_risk_score:
   - 0  = highly distinctive, non-generic, hard to confuse with any other picture book
   - 25 = clearly distinctive with a specific story engine and visual hook
   - 50 = mixed: has some specific engine but plot could exist with different props
   - 75 = generic: the story can be retitled around another object with little plot change
   - 100 = extremely generic: pure trope with no distinctive engine (e.g. "child learns lesson from moon")
   LOWER IS BETTER. Do NOT invert this scale.

2. Do NOT penalize a story merely because it uses a familiar kid-friendly noun such as
   moon, star, tooth, sock, sandwich, umbrella, button, jar, animal, kitchen, invention,
   bedtime, or lunchbox. Penalize ONLY if the story ENGINE and PAGE-TURNS are
   generic and interchangeable. Familiar categories are ALLOWED if the execution is specific.

3. Distinguish:
   - "familiar category" (bedtime, invention, cozy object) — NOT a penalty by itself
   - "familiar object" (moon, tooth, sock) — NOT a penalty by itself
   - "generic execution" (interchangeable plot beats, moral-of-the-story ending) — YES penalty
   - "distinctive story engine" (a specific mechanic that drives every page-turn) — CREDIT
   - "unique visual hook" (a concrete image repeated with variation) — CREDIT

4. Subscores you must compute (higher is more specific, EXCEPT trope_dependency):
   - premise_specificity_score (0-100, higher = premise cannot exist without its specific elements)
   - story_engine_specificity_score (0-100, higher = the mechanic on each page requires this premise)
   - visual_hook_specificity_score (0-100, higher = the visual image is concrete and repeatable)
   - retitle_resistance_score (0-100, higher = swapping the noun would break the plot)
   - trope_dependency_score (0-100, higher = more dependent on well-worn tropes)

5. Derive generic_story_risk_score from the subscores. Rough formula:
   generic_story_risk ≈ round( (100 - premise_specificity)*0.15
                              + (100 - story_engine_specificity)*0.30
                              + (100 - visual_hook_specificity)*0.15
                              + (100 - retitle_resistance)*0.25
                              + trope_dependency*0.15 )
   Then adjust ±10 based on evidence. Never assign generic_story_risk without justifying it in generic_risk_analysis.

RUBRIC ANCHORS with examples:

--- generic_story_risk 0-25 (distinctive / low risk) ---
Traits: a specific story engine that cannot be swapped without changing the plot;
protagonist, object, world, conflict, and page-turn structure are tightly connected;
concrete repeatable visual hook; NOT merely "a child learns a lesson" with interchangeable props.
Familiar categories are allowed if the engine is specific.
Examples:
  A sneeze-powered sock sorter that creates mismatched sock characters and a sorting-by-story parade.
  A lunch sandwich that rearranges itself into obstacle-course layers with specific food-character rules.
  A tiny elevator inside a cereal box that takes siblings to different breakfast planets.
  A wobbly tooth that is literally the physical KEY to a wormhole in the bathroom sink, escalating sink gags.

--- generic_story_risk 40-60 (moderate risk) ---
Traits: concrete object or setting exists, but the plot could still be retitled easily;
some page-turns are specific but the emotional arc is common;
familiar children's-book trope plus one twist.

--- generic_story_risk 75-100 (high risk / generic) ---
Traits: the story can be retitled around another object with little plot change; interchangeable moral lesson.
Examples:
  Moon helps child sleep by watching over them.
  Child names feelings with a comforting object.
  Toy/animal learns it is okay to be different.
  Generic "invention goes wrong, kid learns lesson" WITHOUT a specific mechanical rule.
  Cozy bedtime object that hums lullabies.

===========================================================================
REREAD_VALUE RUBRIC ANCHORS (v3) — measurable, not vibes.
Do NOT default to 80 because you are unsure. Score against these criteria and
FILL reread_evidence. If you cannot fill reread_evidence, the score is <80.

--- reread_value 90-100 (kid demands "again!") ---
ALL of:
  * A chantable refrain (a short repeatable line kids can say aloud) appears
    ≥3 times in the manuscript, ideally with escalating variation.
  * Participation beats on most spreads: call-and-response, a body movement
    (stomp, sneeze, whisper), or a prediction the child completes.
  * Cumulative or predictable structure so a returning kid knows what's coming
    but still enjoys the reveal.
  * At least one hidden-detail thread designed to be spotted on re-reads
    (recurring visual motif, hidden character, running-gag object).
  * Last line invites another read (question, callback, reset, or "let's do
    it again" moment) — not a moral summary.

--- reread_value 80-89 (has one hook but incomplete) ---
Refrain present but appears <3 times OR is not chantable (too long / abstract);
OR participation beats exist but only on 1-2 spreads; OR hidden thread missing.

--- reread_value 60-79 (decorative repetition only) ---
Words repeat but there's no chantable phrase kids would say aloud, no
participation trigger, no re-read hunt, no callback ending.

--- reread_value below 60 ---
Purely narrated. No repetition, no participation, no hook to return.

===========================================================================
PARENT_BUYER_VALUE RUBRIC ANCHORS (v3) — measurable.
Score against these; fill parent_buyer_evidence.

--- parent_buyer_value 90-100 ---
ALL of: clear developmental theme a parent can name in one sentence (e.g.
"handles sibling frustration", "regulates big feelings", "problem-solving
through iteration"); implicit lesson emerges from the plot, not a spoken
moral; child character has real agency and initiates the solution; ends on
warmth without preaching; reading experience is FUN first, teaching second.

--- parent_buyer_value 80-89 ---
Theme is present but a shopping parent might not spot it in 3 seconds; OR the
lesson is stated ("and that's how she learned...") instead of shown.

--- parent_buyer_value below 80 ---
No clear developmental hook a parent would pay for OR overtly moralizing.`;

const SCHEMA_HINT = `Return JSON exactly like:
{
 "age_appropriateness_score": 0,
 "story_coherence_score": 0,
 "emotional_payoff_score": 0,
 "reread_value_score": 0,
 "language_level_score": 0,
 "page_turn_rhythm_score": 0,
 "parent_buyer_value_score": 0,
 "premise_specificity_score": 0,
 "story_engine_specificity_score": 0,
 "visual_hook_specificity_score": 0,
 "retitle_resistance_score": 0,
 "trope_dependency_score": 0,
 "generic_story_risk_score": 0,
 "generic_risk_analysis": {
   "distinctive_details": ["what exact details make it distinctive"],
   "generic_details": ["what exact details feel generic"],
   "could_be_retitled": false,
   "specific_page_turn_moments": ["page-turn moments that are specific to THIS premise"]
 },
 "reread_evidence": {
   "refrain_text": "the exact chantable line, verbatim, or empty string",
   "refrain_count": 0,
   "participation_beats": ["short phrases from the manuscript that trigger a call-and-response or body movement"],
   "hidden_thread": "recurring motif designed for re-read hunts, or empty string",
   "callback_ending": false
 },
 "parent_buyer_evidence": {
   "developmental_theme_one_liner": "one sentence a parent would recognize on a storefront",
   "lesson_is_shown_not_told": true,
   "child_has_agency": true,
   "moralizing_lines": ["quotes of any lecturing lines, or empty array"]
 },
 "evidence": [
   {"dimension":"age_appropriateness","quote":"...","page":3,"reason":"...","repair_action":"none|rewrite_page|rewrite_ending|simplify_vocab|add_refrain|rewrite_manuscript"}
 ]
}`;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

export async function runKidsStoryJudge(opts: RunStoryJudgeOpts): Promise<StoryReport> {
  const pagePlan = (opts.page_texts ?? []).map((t, i) => `Page ${i + 1}: ${t}`).join("\n").slice(0, 4000);
  const user = `Title: "${opts.title}"
Subtitle: ${opts.subtitle ?? "(none)"}
Target age band: ${opts.ageBand ?? "3-6"}

MANUSCRIPT:
"""
${opts.manuscript_md.slice(0, 8000)}
"""

PAGE PLAN (if available):
${pagePlan || "(not available)"}

Judge this book strictly and FAIRLY per the rubric above.
Remember: LOW generic_story_risk_score means DISTINCTIVE. Do not default to mid-range if the story has a specific engine.
${SCHEMA_HINT}`;

  async function callOnce(): Promise<Record<string, unknown>> {
    // Prefer google_direct (owner order 2026-07-18: reduce gateway spend on
    // high-volume Gemini judges). Falls through to the gateway on failure.
    if (hasGeminiDirect()) {
      try {
        const r = await geminiDirectChat({
          system: SYSTEM,
          user: user,
          model: JUDGE_MODEL,
          responseJson: true,
        });
        logAiCost(costDb(), {
          ebook_id: opts.ebook_id,
          step: "kids_story_judge",
          model: JUDGE_MODEL,
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          provider: "google_direct",
        });
        const parseResult = parseModelJson<Record<string, unknown>>(r.text);
        if (!parseResult.ok) throw new Error(`story_judge_json_parse_failed: ${parseResult.diagnostics.errors.slice(-1)[0] ?? "unknown"}`);
        return parseResult.value;
      } catch (e) {
        console.warn(`[kids-story-judge] google_direct failed, falling back to gateway: ${(e as Error).message}`);
      }
    }
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`story judge ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const usage = j.usage ?? {};
    logAiCost(costDb(), {
      ebook_id: opts.ebook_id,
      step: "kids_story_judge",
      model: JUDGE_MODEL,
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      provider: "gateway",
    });
    const raw = j.choices?.[0]?.message?.content ?? "";
    const parseResult = parseModelJson<Record<string, unknown>>(raw);
    if (!parseResult.ok) {
      throw new Error(`story_judge_json_parse_failed: ${parseResult.diagnostics.errors.slice(-1)[0] ?? "unknown"}`);
    }
    return parseResult.value;
  }
  let parsed: Record<string, unknown>;
  try { parsed = await callOnce(); }
  catch (_e1) {
    // One retry on transient malformed-JSON.
    parsed = await callOnce();
  }


  const rereadEvidence = (parsed.reread_evidence ?? undefined) as StoryReport["reread_evidence"];
  const parentEvidence = (parsed.parent_buyer_evidence ?? undefined) as StoryReport["parent_buyer_evidence"];

  const report: StoryReport = {
    age_appropriateness_score: num(parsed.age_appropriateness_score),
    story_coherence_score: num(parsed.story_coherence_score),
    emotional_payoff_score: num(parsed.emotional_payoff_score),
    reread_value_score: num(parsed.reread_value_score),
    language_level_score: num(parsed.language_level_score),
    page_turn_rhythm_score: num(parsed.page_turn_rhythm_score),
    parent_buyer_value_score: num(parsed.parent_buyer_value_score),
    premise_specificity_score: num(parsed.premise_specificity_score),
    story_engine_specificity_score: num(parsed.story_engine_specificity_score),
    visual_hook_specificity_score: num(parsed.visual_hook_specificity_score),
    retitle_resistance_score: num(parsed.retitle_resistance_score),
    trope_dependency_score: num(parsed.trope_dependency_score),
    generic_story_risk_score: num(parsed.generic_story_risk_score),
    story_qc_passed: false,
    evidence: Array.isArray(parsed.evidence) ? (parsed.evidence as StoryReport["evidence"]) : [],
    generic_risk_analysis: (parsed.generic_risk_analysis ?? undefined) as StoryReport["generic_risk_analysis"],
    reread_evidence: rereadEvidence,
    parent_buyer_evidence: parentEvidence,
    score_adjustments: [],
    judge_version: JUDGE_VERSION,
    computed_at: new Date().toISOString(),
  };

  // Deterministic post-judge verifier — cancels the LLM's "vibes 80" default in
  // both directions. If the judge claims a high score but the evidence isn't
  // actually in the manuscript, cap it. If the evidence IS there but the judge
  // was stingy, floor it. This gives the skill-learner a real signal.
  applyDeterministicScoreCalibration(report, opts.manuscript_md);

  report.story_qc_passed =
    report.age_appropriateness_score >= 90 &&
    report.story_coherence_score >= 90 &&
    report.emotional_payoff_score >= 85 &&
    report.reread_value_score >= 85 &&
    report.language_level_score >= 90 &&
    report.parent_buyer_value_score >= 85 &&
    report.generic_story_risk_score <= 25;
  return report;
}

// ---------------------------------------------------------------------------
// Deterministic score calibration
// ---------------------------------------------------------------------------
// LLM judges cluster around 80 on subjective dimensions (reread_value,
// parent_buyer_value). To break that anchor bias we verify the evidence the
// judge itself provided against the actual manuscript text, then cap or floor
// the score. All adjustments are recorded in report.score_adjustments.

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const h = norm(haystack);
  const n = norm(needle);
  if (n.length < 3) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = h.indexOf(n, idx)) !== -1) { count++; idx += n.length; }
  return count;
}

function applyDeterministicScoreCalibration(report: StoryReport, manuscript: string): void {
  const adj: NonNullable<StoryReport["score_adjustments"]> = report.score_adjustments ?? [];

  // ---- reread_value ----
  const re = report.reread_evidence;
  let refrainCount = 0;
  let participationHits = 0;
  let hasHiddenThread = false;
  let hasCallback = false;
  if (re) {
    refrainCount = re.refrain_text ? countOccurrences(manuscript, re.refrain_text) : 0;
    participationHits = (re.participation_beats ?? []).filter(p => countOccurrences(manuscript, p) > 0).length;
    hasHiddenThread = !!(re.hidden_thread && re.hidden_thread.trim().length > 3);
    hasCallback = !!re.callback_ending;
  }
  // Criteria for a genuine 90+.
  const meets90 = refrainCount >= 3 && participationHits >= 2 && hasHiddenThread && hasCallback;
  // Criteria for a genuine 85+.
  const meets85 = refrainCount >= 2 && participationHits >= 1;

  const rerBefore = report.reread_value_score;
  if (rerBefore >= 90 && !meets90) {
    const capped = meets85 ? 85 : 78;
    report.reread_value_score = capped;
    adj.push({ dimension: 'reread_value', from: rerBefore, to: capped, reason: `judge_cap: refrain_count=${refrainCount} participation=${participationHits} hidden=${hasHiddenThread} callback=${hasCallback}` });
  } else if (rerBefore >= 85 && rerBefore < 90 && !meets85) {
    report.reread_value_score = 78;
    adj.push({ dimension: 'reread_value', from: rerBefore, to: 78, reason: `judge_cap: refrain_count=${refrainCount} participation=${participationHits}` });
  } else if (rerBefore < 85 && meets85) {
    // Judge was stingy but the evidence is real. Floor at 85 (or 90 if all criteria met).
    const floored = meets90 ? 90 : 85;
    report.reread_value_score = floored;
    adj.push({ dimension: 'reread_value', from: rerBefore, to: floored, reason: `evidence_floor: refrain_count=${refrainCount} participation=${participationHits} hidden=${hasHiddenThread} callback=${hasCallback}` });
  }

  // ---- parent_buyer_value ----
  const pe = report.parent_buyer_evidence;
  const themeLen = pe?.developmental_theme_one_liner?.trim().length ?? 0;
  const shown = !!pe?.lesson_is_shown_not_told;
  const agency = !!pe?.child_has_agency;
  const moralizes = (pe?.moralizing_lines ?? []).some(l => l && l.trim().length > 0);
  const parentMeets90 = themeLen >= 20 && shown && agency && !moralizes;
  const parentMeets85 = themeLen >= 10 && (shown || agency) && !moralizes;

  const pbBefore = report.parent_buyer_value_score;
  if (pbBefore >= 90 && !parentMeets90) {
    const capped = parentMeets85 ? 85 : 78;
    report.parent_buyer_value_score = capped;
    adj.push({ dimension: 'parent_buyer_value', from: pbBefore, to: capped, reason: `judge_cap: theme_len=${themeLen} shown=${shown} agency=${agency} moralizes=${moralizes}` });
  } else if (pbBefore >= 85 && pbBefore < 90 && !parentMeets85) {
    report.parent_buyer_value_score = 78;
    adj.push({ dimension: 'parent_buyer_value', from: pbBefore, to: 78, reason: `judge_cap: theme_len=${themeLen} shown=${shown} agency=${agency} moralizes=${moralizes}` });
  } else if (pbBefore < 85 && parentMeets85) {
    const floored = parentMeets90 ? 90 : 85;
    report.parent_buyer_value_score = floored;
    adj.push({ dimension: 'parent_buyer_value', from: pbBefore, to: floored, reason: `evidence_floor: theme_len=${themeLen} shown=${shown} agency=${agency}` });
  }

  report.score_adjustments = adj;
}

export function storyReportToFindings(s: StoryReport): RawFinding[] {
  const out: RawFinding[] = [];
  const gate = [
    { key: "age_appropriateness_score", cat: "age_appropriateness", rule: "STORY_AGE_APPROPRIATENESS", min: 90 },
    { key: "story_coherence_score", cat: "story_structure", rule: "STORY_COHERENCE", min: 90 },
    { key: "emotional_payoff_score", cat: "story_structure", rule: "STORY_EMOTIONAL_PAYOFF", min: 85 },
    { key: "reread_value_score", cat: "story_structure", rule: "STORY_REREAD_VALUE", min: 85 },
    { key: "language_level_score", cat: "grammar", rule: "STORY_LANGUAGE_LEVEL", min: 90 },
    { key: "parent_buyer_value_score", cat: "commercial_metadata", rule: "STORY_PARENT_BUYER_VALUE", min: 85 },
  ] as const;
  for (const g of gate) {
    const v = (s as unknown as Record<string, number>)[g.key];
    const passed = v >= g.min;
    out.push({
      rule_id: passed ? `${g.rule}_OK` : g.rule,
      category: g.cat,
      severity: passed ? "minor" : "critical",
      passed,
      measured_value: { score: v, evidence: s.evidence.filter((e) => e.dimension?.includes(g.key.replace("_score", ""))).slice(0, 3) },
      threshold: { min: g.min },
      repair_action: passed ? undefined : "targeted_manuscript_rewrite",
    });
  }
  const genericPassed = s.generic_story_risk_score <= 25;
  out.push({
    rule_id: genericPassed ? "STORY_GENERIC_RISK_OK" : "STORY_GENERIC_RISK_HIGH",
    category: "story_structure",
    severity: genericPassed ? "minor" : "critical",
    passed: genericPassed,
    measured_value: {
      generic_story_risk: s.generic_story_risk_score,
      subscores: {
        premise_specificity: s.premise_specificity_score,
        story_engine_specificity: s.story_engine_specificity_score,
        visual_hook_specificity: s.visual_hook_specificity_score,
        retitle_resistance: s.retitle_resistance_score,
        trope_dependency: s.trope_dependency_score,
      },
      analysis: s.generic_risk_analysis,
    },
    threshold: { max: 25 },
    repair_action: genericPassed ? undefined : "rewrite_manuscript_for_originality",
  });
  return out;
}
