// Shared idea-improvement helper. Used by both generate-idea (Auto Improve Level 1)
// and improve-idea (admin "Improve Again" — Level 2+).
import { aiJSON, logCost, pickModel } from "./ai.ts";

export interface Scores {
  urgency: number; transformation: number; commercial: number;
  evergreen: number; emotional: number; clarity: number;
}
export interface ValueBoosters {
  checklist: string; template: string; workbook: string;
  calculator: string; action_plan: string;
}
export interface ImprovedIdea {
  title: string; subtitle: string; target_buyer: string; hook: string;
  pain_point: string; emotional_fear: string; transformation: string;
  value_boosters: ValueBoosters; why_it_sells: string;
  scores: Scores; rationale: string;
  recommended_action: "Generate Ebook" | "Improve Again" | "Reject";
}

export type ImproveAction = "all" | "title" | "hook";

export interface ImproveInput {
  id: string;
  title: string;
  subtitle?: string | null;
  target_buyer?: string | null;
  hook?: string | null;
  total_score?: number | null;
  category?: { name?: string | null; description?: string | null } | null;
  admin_feedback?: string | null;
  round: number; // current improvement_round BEFORE this pass
  action?: ImproveAction;
  mode?: string;
}

function buildPrompt(input: ImproveInput) {
  const action = input.action ?? "all";
  const level = input.round + 1;
  const isLevel2Plus = level >= 2;

  const focus = action === "title"
    ? "Rewrite ONLY the title to be more specific, benefit-driven, and curiosity-inducing. Keep subtitle/hook the same unless minor polish is required."
    : action === "hook"
    ? "Rewrite ONLY the hook to be more urgent and emotional, with a clear transformation. Keep title/subtitle the same."
    : isLevel2Plus
    ? "This is a SECOND-PASS improvement on an already-improved idea. Make it noticeably more commercial, emotionally sharper, more specific, and more clearly valuable as a paid PDF ebook. Sharpen buyer identity. Add concrete numbers/timeframes when honest."
    : "Improve every field: sharper title, more urgent pain in the subtitle, clearer transformation, stronger hook. Add specifics (numbers, timeframes, named outcomes) when honest.";

  const sys = `You are an expert USA ebook product strategist and ethical direct-response copywriter.

Your task is to transform an ebook idea into a premium, emotionally compelling, commercially sellable PDF ebook concept for American buyers.

Apply USA buyer psychology:
- People buy relief from pain, clarity when overwhelmed, control when life feels uncertain.
- People buy protection for family, money, career, health, or future.
- People buy shortcuts that save time.
- People buy systems, checklists, templates, and step-by-step plans.
- People buy products that feel made for their exact identity and situation.

Rules:
- American English. Clear, emotional, premium tone. Never academic, never clickbait, never scammy.
- NO fake guarantees. NO promises of guaranteed income, savings, health, relationship, or legal outcomes.
- NO medical claims. Keep the promise practical and believable.
- Make the buyer feel: "This is exactly for me."`;

  const feedback = input.admin_feedback?.trim()
    ? `\nAdmin feedback to address:\n${input.admin_feedback.trim()}\n`
    : "";

  const user = `Improve this ebook idea so the buyer-appeal score rises above 80/100 when possible.

Category: ${input.category?.name ?? "n/a"} — ${input.category?.description ?? ""}
Planned price: $19–$29 · Planned word count: ~18,000 words (70–90 page PDF)
Improvement round about to run: Level ${level}

Current Ebook Idea:
- Title: ${input.title}
- Subtitle: ${input.subtitle ?? ""}
- Target buyer: ${input.target_buyer ?? ""}
- Hook: ${input.hook ?? ""}
- Current raw score: ${input.total_score ?? 0}/60
${feedback}
Focus: ${focus}

Return JSON exactly in this shape:
{
  "title": "stronger, premium, emotional title",
  "subtitle": "premium subtitle that clarifies the transformation",
  "target_buyer": "specific persona — who exactly, age/role/situation, why they need it now",
  "hook": "one strong sales hook under 40 words",
  "pain_point": "the clear, concrete pain this PDF resolves",
  "emotional_fear": "the deeper fear or identity threat behind the pain",
  "transformation": "what the buyer will be able to understand, organize, improve, or start doing after reading",
  "value_boosters": {
    "checklist": "name of a checklist included",
    "template": "name of a template included",
    "workbook": "name of a workbook section included",
    "calculator": "name of a calculator or worksheet included",
    "action_plan": "name of a 7-day or 30-day action plan included"
  },
  "why_it_sells": "1–2 sentences explaining commercial appeal to USA buyers",
  "scores": { "urgency": 1-10, "transformation": 1-10, "commercial": 1-10, "evergreen": 1-10, "emotional": 1-10, "clarity": 1-10 },
  "rationale": "one sentence on what you changed and why it lifts the score",
  "recommended_action": "Generate Ebook | Improve Again | Reject"
}`;

  return { sys, user };
}

export interface ImproveResult {
  improved: ImprovedIdea;
  total_score: number;
  score_100: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cost_usd: number };
}

export async function improveIdea(input: ImproveInput): Promise<ImproveResult> {
  const { sys, user } = buildPrompt(input);
  const model = pickModel(input.mode ?? "hybrid", "marketing");
  const ai = await aiJSON<ImprovedIdea>({ system: sys, user, model });
  const s = ai.data.scores;
  const total = (s?.urgency ?? 0) + (s?.transformation ?? 0) + (s?.commercial ?? 0)
              + (s?.evergreen ?? 0) + (s?.emotional ?? 0) + (s?.clarity ?? 0);
  return {
    improved: ai.data,
    total_score: total,
    score_100: Math.round(total / 60 * 100),
    model: ai.model,
    usage: ai.usage,
  };
}

// Map 0-100 score to thresholds used across the app.
export function statusForScore(score100: number): { status: "approved" | "needs_review" | "weak"; action: string } {
  if (score100 >= 80) return { status: "approved", action: "Generate Ebook" };
  if (score100 >= 60) return { status: "needs_review", action: "Improve Again" };
  return { status: "weak", action: "Reject or Auto-Improve Level 2" };
}

// Apply an improvement result to the ebook_ideas row. Preserves raw_* on first improvement.
export async function applyImprovement(
  db: ReturnType<typeof import("./ai.ts").admin>,
  ideaId: string,
  current: {
    title: string; subtitle: string | null; hook: string | null; target_buyer: string | null;
    raw_title: string | null; improvement_round: number; notes: string | null;
  },
  result: ImproveResult,
  meta: { source: "auto-level-1" | "improve-again"; action: ImproveAction; admin_feedback?: string | null },
) {
  const i = result.improved;
  const nextRound = current.improvement_round + 1;
  const preserveRaw = !current.raw_title; // first improvement only
  const prevNotes = current.notes ? `${current.notes}\n--\n` : "";
  const note = `[${meta.source}:L${nextRound}:${meta.action}] score ${result.score_100}/100 — ${i.rationale ?? ""}`;

  const update: Record<string, unknown> = {
    title: i.title,
    subtitle: i.subtitle,
    target_buyer: i.target_buyer,
    hook: i.hook,
    scores: i.scores,
    total_score: result.total_score,
    status: "idea",
    core_pain_point: i.pain_point,
    deeper_emotional_fear: i.emotional_fear,
    transformation_promise: i.transformation,
    perceived_value_boosters: i.value_boosters ?? {},
    why_it_sells: i.why_it_sells,
    recommended_action: i.recommended_action,
    improvement_round: nextRound,
    notes: prevNotes + note,
  };
  if (preserveRaw) {
    update.raw_title = current.title;
    update.raw_subtitle = current.subtitle;
    update.raw_hook = current.hook;
    update.raw_target_buyer = current.target_buyer;
  }
  if (meta.admin_feedback) update.admin_feedback = meta.admin_feedback;

  await db.from("ebook_ideas").update(update).eq("id", ideaId);
  await logCost(db, {
    idea_id: ideaId,
    step: `${meta.source}:L${nextRound}:${meta.action}`,
    model: result.model, ...result.usage,
  });
}
