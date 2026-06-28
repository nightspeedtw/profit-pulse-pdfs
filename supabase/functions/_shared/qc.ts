// Shared QC scoring + auto-gate helpers used by the autopilot orchestrator
// and the writer functions. All scoring calls return JSON only; uses the
// robust JSON extractor from ai.ts.
import { aiJSON, aiText, admin, logCost, pickModel } from "./ai.ts";
import { HARDSELL_COPYWRITER_SYSTEM, PREMIUM_WRITER_SYSTEM } from "./prompts.ts";

// ---------------- Thresholds (server-enforced) ----------------
export const TH = {
  topicMinScore: 80,        // Buyer Appeal / Premium / Hard-Sell
  topicMaxCompliance: 4,    // 1 safest, 10 risky
  outlineMinScore: 80,
  chapterMinScore: 80,
  productCopyMinScore: 80,
  productCopyMaxCompliance: 4,
  publishMinFinalQuality: 90,
  publishMinConversion: 85,
  publishMinComplianceSafety: 90,
  maxTopicRewrites: 2,
  maxOutlineRewrites: 2,
  maxChapterRewrites: 1,
  maxEditorialRewrites: 2,
  maxProductCopyRewrites: 1,
} as const;

// ---------------- Run logger ----------------
export async function logRun(db: ReturnType<typeof admin>, row: {
  ebook_id?: string | null;
  idea_id?: string | null;
  step: string;
  status: "ok" | "fail" | "rewrite" | "reject" | "skip";
  score?: number | null;
  rewrite_count?: number;
  cost_usd?: number;
  duration_ms?: number;
  error?: string | null;
  payload?: Record<string, unknown>;
}) {
  try {
    await db.from("autopilot_runs").insert({
      ebook_id: row.ebook_id ?? null,
      idea_id: row.idea_id ?? null,
      step: row.step,
      status: row.status,
      score: row.score ?? null,
      rewrite_count: row.rewrite_count ?? 0,
      cost_usd: row.cost_usd ?? 0,
      duration_ms: row.duration_ms ?? null,
      error: row.error ?? null,
      payload: row.payload ?? {},
    });
  } catch (e) {
    console.error("logRun failed", e);
  }
}

// ---------------- Topic QC ----------------
export interface TopicScores {
  buyer_appeal_score: number;
  premium_score: number;
  hard_sell_strength_score: number;
  commercial_intent_score: number;
  clarity_score: number;
  compliance_risk_score: number;
  rationale: string;
}

export async function scoreTopic(model: string, idea: {
  title: string; subtitle?: string | null; hook?: string | null; target_buyer?: string | null;
  category?: string | null;
}) {
  return aiJSON<TopicScores>({
    model,
    system: HARDSELL_COPYWRITER_SYSTEM + "\n\nYou are now scoring a topic for commercial strength. Be honest and critical — premium scores require true buyer pull, not generic appeal.",
    user: `Score this ebook topic for the USA premium PDF buyer market.

Title: ${idea.title}
Subtitle: ${idea.subtitle ?? ""}
Hook: ${idea.hook ?? ""}
Target Buyer: ${idea.target_buyer ?? ""}
Category: ${idea.category ?? ""}

Return JSON only:
{
  "buyer_appeal_score": 0-100,
  "premium_score": 0-100,
  "hard_sell_strength_score": 0-100,
  "commercial_intent_score": 0-100,
  "clarity_score": 0-100,
  "compliance_risk_score": 1-10,
  "rationale": "1-3 sentences"
}`,
  });
}

export function topicGate(s: TopicScores): { pass: boolean; reason: string } {
  if (s.compliance_risk_score > TH.topicMaxCompliance) {
    return { pass: false, reason: `compliance_risk=${s.compliance_risk_score} > ${TH.topicMaxCompliance}` };
  }
  const failing: string[] = [];
  if (s.buyer_appeal_score < TH.topicMinScore) failing.push(`buyer=${s.buyer_appeal_score}`);
  if (s.premium_score < TH.topicMinScore) failing.push(`premium=${s.premium_score}`);
  if (s.hard_sell_strength_score < TH.topicMinScore) failing.push(`hard_sell=${s.hard_sell_strength_score}`);
  return failing.length ? { pass: false, reason: failing.join(", ") } : { pass: true, reason: "ok" };
}

export async function rewriteTopic(model: string, idea: {
  title: string; subtitle?: string | null; hook?: string | null; target_buyer?: string | null;
  category?: string | null;
}, failReason: string, complianceMode: boolean) {
  const safer = complianceMode
    ? "Compliance risk is too high — rewrite with safer, educational language. Avoid guarantees, income claims, medical/legal/financial promises. Add hedging ('may help', 'general guide', 'consider', 'consult a qualified professional')."
    : "Strengthen buyer appeal, premium feel, and hard-sell pull while staying honest.";
  return aiJSON<{ title: string; subtitle: string; hook: string }>({
    model,
    system: HARDSELL_COPYWRITER_SYSTEM,
    user: `Rewrite this ebook concept to fix the following weakness: ${failReason}.
${safer}

Current:
Title: ${idea.title}
Subtitle: ${idea.subtitle ?? ""}
Hook: ${idea.hook ?? ""}
Target Buyer: ${idea.target_buyer ?? ""}
Category: ${idea.category ?? ""}

Return JSON: { "title": "...", "subtitle": "...", "hook": "..." }`,
  });
}

// ---------------- Outline QC ----------------
export interface OutlineScores {
  structure_score: number;
  practical_score: number;
  buyer_score: number;
  depth_score: number;
  premium_score: number;
  duplicate_score: number;
  notes: string;
}

export async function scoreOutline(model: string, opts: {
  title: string; toc: { title: string; brief: string }[]; bonuses: Record<string, string>;
}) {
  return aiJSON<OutlineScores>({
    model,
    system: PREMIUM_WRITER_SYSTEM + "\n\nYou are now scoring an outline for a premium paid ebook. Be critical — generic chapter lists fail.",
    user: `Score this outline:
Title: ${opts.title}
Chapters:
${opts.toc.map((c, i) => `${i + 1}. ${c.title} — ${c.brief}`).join("\n")}
Bonuses: ${Object.entries(opts.bonuses).map(([k, v]) => `${k}: ${v}`).join(" | ")}

Return JSON only:
{
  "structure_score": 0-100,
  "practical_score": 0-100,
  "buyer_score": 0-100,
  "depth_score": 0-100,
  "premium_score": 0-100,
  "duplicate_score": 0-100,
  "notes": "1-3 sentences identifying weak chapters or missing pieces"
}`,
  });
}

export function outlineGate(s: OutlineScores): { pass: boolean; reason: string } {
  const fail: string[] = [];
  for (const [k, v] of Object.entries({
    structure: s.structure_score, practical: s.practical_score, buyer: s.buyer_score,
    depth: s.depth_score, premium: s.premium_score, duplicate: s.duplicate_score,
  })) if (v < TH.outlineMinScore) fail.push(`${k}=${v}`);
  return fail.length ? { pass: false, reason: fail.join(", ") } : { pass: true, reason: "ok" };
}

// ---------------- Chapter QC ----------------
export interface ChapterScores {
  depth_score: number;
  clarity_score: number;
  practicality_score: number;
  non_generic_score: number;
  buyer_value_score: number;
  compliance_safety_score: number;
  issues: string[];
}

export async function scoreChapter(model: string, chapterTitle: string, content: string) {
  const sample = content.length > 12000 ? content.slice(0, 12000) + "\n…(truncated)" : content;
  return aiJSON<ChapterScores>({
    model,
    system: "You are a brutal premium-ebook editor scoring a single chapter for paid-product quality. Return JSON only.",
    user: `Chapter title: ${chapterTitle}
Chapter content:
"""
${sample}
"""

Score each dimension 0-100. compliance_safety_score is 0-100 where 100 = perfectly safe educational language.
Return JSON only:
{
  "depth_score": 0-100,
  "clarity_score": 0-100,
  "practicality_score": 0-100,
  "non_generic_score": 0-100,
  "buyer_value_score": 0-100,
  "compliance_safety_score": 0-100,
  "issues": ["short bullet of any concrete issue"]
}`,
  });
}

export function chapterGate(s: ChapterScores): { pass: boolean; reason: string } {
  const fail: string[] = [];
  for (const [k, v] of Object.entries({
    depth: s.depth_score, clarity: s.clarity_score, practicality: s.practicality_score,
    non_generic: s.non_generic_score, buyer_value: s.buyer_value_score,
    compliance: s.compliance_safety_score,
  })) if (v < TH.chapterMinScore) fail.push(`${k}=${v}`);
  return fail.length ? { pass: false, reason: fail.join(", ") } : { pass: true, reason: "ok" };
}

// ---------------- Editorial (whole-book) QC ----------------
export interface EditorialScores {
  final_quality_score: number;
  compliance_safety_score: number;
  flow_score: number;
  issues: string[];
  blocking_issues: string[];
}

export async function scoreEditorial(model: string, opts: {
  title: string; toc: { title: string }[]; chapters: { title: string; content: string }[]; bonuses: Record<string, string>;
}) {
  // Send chapter summaries + opening of each to keep within token budget
  const summary = opts.chapters.map((c, i) =>
    `### Ch ${i + 1}: ${c.title}\n${(c.content ?? "").slice(0, 1500)}…`).join("\n\n");
  return aiJSON<EditorialScores>({
    model,
    system: "You are the final editorial reviewer for a premium paid PDF ebook. Check for: repetition, thin content, AI-sounding language, weak examples, missing action steps, missing templates, overpromising, unsafe claims, poor flow, formatting issues. Return JSON only.",
    user: `Ebook: ${opts.title}
Chapter samples (truncated):
${summary}

Bonuses: ${Object.keys(opts.bonuses).join(", ")}

Return JSON:
{
  "final_quality_score": 0-100,
  "compliance_safety_score": 0-100,
  "flow_score": 0-100,
  "issues": ["short bullet, max 8"],
  "blocking_issues": ["only issues serious enough to block publish"]
}`,
  });
}

// ---------------- Product copy QC ----------------
export interface ProductCopyScores {
  conversion_score: number;
  hook_score: number;
  clarity_score: number;
  premium_score: number;
  compliance_safety_score: number;
  seo_score: number;
  compliance_risk_score: number; // 1-10
  issues: string[];
}

export async function scoreProductCopy(model: string, copy: {
  product_description: string; seo_title?: string; seo_meta?: string; tags?: string[];
}) {
  return aiJSON<ProductCopyScores>({
    model,
    system: HARDSELL_COPYWRITER_SYSTEM + "\n\nYou are now scoring Shopify product page copy for conversion + compliance.",
    user: `Score this product page copy:

Description:
${copy.product_description}

SEO Title: ${copy.seo_title ?? ""}
SEO Meta: ${copy.seo_meta ?? ""}
Tags: ${(copy.tags ?? []).join(", ")}

Return JSON only:
{
  "conversion_score": 0-100,
  "hook_score": 0-100,
  "clarity_score": 0-100,
  "premium_score": 0-100,
  "compliance_safety_score": 0-100,
  "seo_score": 0-100,
  "compliance_risk_score": 1-10,
  "issues": ["short bullet"]
}`,
  });
}

export function productCopyGate(s: ProductCopyScores): { pass: boolean; reason: string } {
  if (s.compliance_risk_score > TH.productCopyMaxCompliance) {
    return { pass: false, reason: `compliance_risk=${s.compliance_risk_score}` };
  }
  const fail: string[] = [];
  for (const [k, v] of Object.entries({
    conversion: s.conversion_score, hook: s.hook_score, clarity: s.clarity_score,
    premium: s.premium_score, compliance: s.compliance_safety_score, seo: s.seo_score,
  })) if (v < TH.productCopyMinScore) fail.push(`${k}=${v}`);
  return fail.length ? { pass: false, reason: fail.join(", ") } : { pass: true, reason: "ok" };
}

// ---------------- Publish gate ----------------
export function publishGate(e: {
  final_quality_score?: number | null;
  conversion_score?: number | null;
  compliance_safety_score?: number | null;
  cover_url?: string | null;
  pdf_url?: string | null;
  product_description?: string | null;
  shopify_product_id?: string | null;
  cover_approved?: boolean | null;
  cover_score?: number | null;
  pdf_approved?: boolean | null;
  pdf_score?: number | null;
  pdf_status?: string | null;
}): { pass: boolean; reasons: string[] } {
  const r: string[] = [];
  // Permanent global Premium PDF Auto-QC gate: PDF must be 'pdf_ready'.
  // 'pdf_needs_human_review' / 'pdf_qc_failed' / 'pdf_auto_fixing' / 'pdf_qc_pending' all block.
  if (e.pdf_status && e.pdf_status !== "pdf_ready" && e.pdf_status !== "ready") {
    r.push(`pdf_status=${e.pdf_status} (must be pdf_ready)`);
  }
  if ((e.final_quality_score ?? 0) < TH.publishMinFinalQuality) r.push(`final_quality<${TH.publishMinFinalQuality}`);
  if ((e.conversion_score ?? 0) < TH.publishMinConversion) r.push(`conversion<${TH.publishMinConversion}`);
  if ((e.compliance_safety_score ?? 0) < TH.publishMinComplianceSafety) r.push(`compliance_safety<${TH.publishMinComplianceSafety}`);
  if (!e.cover_url) r.push("missing cover");
  if (!e.pdf_url) r.push("missing pdf");
  if (!e.product_description) r.push("missing description");
  if (!e.shopify_product_id) r.push("missing shopify draft");
  if ((e.cover_score ?? 0) < 85) r.push(`cover_score<85`);
  if (!e.cover_approved) r.push("cover not approved");
  if ((e.pdf_score ?? 0) < 90) r.push(`pdf_score<90`);
  if (!e.pdf_approved) r.push("pdf not approved");
  return { pass: r.length === 0, reasons: r };
}


// ---------------- Chapter rewrite helper ----------------
export async function rewriteChapter(model: string, opts: {
  ebookTitle: string; subtitle?: string; targetBuyer?: string; hook?: string;
  chapterTitle: string; brief: string; currentContent: string; issues: string[];
  minWords: number;
}) {
  return aiText({
    model,
    system: PREMIUM_WRITER_SYSTEM,
    user: `Rewrite this chapter to fix the issues listed. Keep it premium, specific, and practical.

Ebook: "${opts.ebookTitle}" — ${opts.subtitle ?? ""}
Reader: ${opts.targetBuyer ?? ""}
Hook: ${opts.hook ?? ""}

Chapter: "${opts.chapterTitle}"
Brief: ${opts.brief}

Issues to fix:
${opts.issues.map((i) => `- ${i}`).join("\n")}

Current draft (rewrite, don't lightly edit):
"""
${opts.currentContent.slice(0, 8000)}
"""

HARD REQUIREMENT: minimum ${opts.minWords} words. Follow the chapter structure (objective → main teaching → practical example → common mistake → step-by-step → quick checklist → key takeaway). American English. Educational tone. No fake stats. No fake experts. Compliance-safe language for sensitive topics.`,
  });
}
