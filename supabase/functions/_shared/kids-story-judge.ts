// LLM-based story/age/reread judge for kids picture books.
// Reads the actual manuscript + page plan and returns evidence-backed scores.

import type { RawFinding } from "./pdf-preflight.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

export interface StoryReport {
  age_appropriateness_score: number;
  story_coherence_score: number;
  emotional_payoff_score: number;
  reread_value_score: number;
  language_level_score: number;
  page_turn_rhythm_score: number;
  parent_buyer_value_score: number;
  generic_story_risk_score: number; // 0=unique, 100=generic
  story_qc_passed: boolean;
  evidence: Array<{ dimension: string; quote?: string; page?: number; reason: string; repair_action: string }>;
  computed_at: string;
}

export interface RunStoryJudgeOpts {
  title: string;
  subtitle?: string | null;
  ageBand?: string | null;
  manuscript_md: string;
  page_texts?: string[];
}

const SYSTEM = `You are a strict children's book editor and buyer. You judge a real manuscript, not marketing metadata.
Assign integer 0-100 scores. Provide EVIDENCE for every dimension: a short quote and/or page number and a reason.
Never give a score without evidence. If you cannot find evidence, score low and explain what is missing.
Return ONLY JSON. No markdown fences.`;

const SCHEMA_HINT = `Return JSON exactly like:
{
 "age_appropriateness_score": 0,
 "story_coherence_score": 0,
 "emotional_payoff_score": 0,
 "reread_value_score": 0,
 "language_level_score": 0,
 "page_turn_rhythm_score": 0,
 "parent_buyer_value_score": 0,
 "generic_story_risk_score": 0,
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

Judge this book strictly. ${SCHEMA_HINT}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`story judge ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const raw = (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const report: StoryReport = {
    age_appropriateness_score: num(parsed.age_appropriateness_score),
    story_coherence_score: num(parsed.story_coherence_score),
    emotional_payoff_score: num(parsed.emotional_payoff_score),
    reread_value_score: num(parsed.reread_value_score),
    language_level_score: num(parsed.language_level_score),
    page_turn_rhythm_score: num(parsed.page_turn_rhythm_score),
    parent_buyer_value_score: num(parsed.parent_buyer_value_score),
    generic_story_risk_score: num(parsed.generic_story_risk_score),
    story_qc_passed: false,
    evidence: Array.isArray(parsed.evidence) ? (parsed.evidence as StoryReport["evidence"]) : [],
    computed_at: new Date().toISOString(),
  };
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
    measured_value: { generic_story_risk: s.generic_story_risk_score },
    threshold: { max: 25 },
    repair_action: genericPassed ? undefined : "rewrite_manuscript_for_originality",
  });
  return out;
}
