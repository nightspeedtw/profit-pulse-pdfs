// Milestone 2 — Premium Title & Hard-Sell Copywriter edge function.
// Two modes:
//   - generate_one_best_concept: returns ONE best sellable ebook concept
//   - generate_two_alternatives: returns EXACTLY TWO alternatives for an existing idea
// Both modes persist results to public.ebook_ideas with strict JSON validation
// and the Milestone 2 quality gate.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { HARDSELL_COPYWRITER_SYSTEM } from "../_shared/prompts.ts";

type Mode = "generate_one_best_concept" | "generate_two_alternatives";

interface ObjectionHandling {
  too_expensive: string;
  not_for_me: string;
  free_info: string;
  no_time: string;
}

interface ConceptJSON {
  title: string;
  subtitle: string;
  hook: string;
  target_buyer: string;
  core_pain_point: string;
  deeper_emotional_fear: string;
  transformation_promise: string;
  value_proposition: string;
  hard_sell_opening: string;
  objection_handling: ObjectionHandling;
  buyer_appeal_score: number;
  premium_score: number;
  hard_sell_strength_score: number;
  compliance_risk_score: number;
  idea_score: number;
  status: "pass" | "needs_alternatives" | "reject";
  compliance_notes: string;
}

// ---------- thresholds (mirrors src/types/ebook-idea.ts) ----------
const TH = {
  buyer_appeal_min: 80,
  premium_min: 80,
  hard_sell_strength_min: 75,
  idea_min: 80,
  compliance_risk_max: 4,
  compliance_risk_reject: 6,
};
const UNSAFE_PATTERNS: RegExp[] = [
  /guarantee[d]?\s+(income|return|results?|profit|cure|outcome|weight\s*loss)/i,
  /100%\s+(safe|guaranteed|cure)/i,
  /risk[-\s]?free/i,
  /miracle\s+(cure|drug|results?)/i,
  /lose\s+\d+\s*(lbs?|kg|pounds)\s+in\s+\d+\s*(days?|weeks?)/i,
];
function unsafeText(t: string | undefined | null): boolean {
  if (!t) return false;
  return UNSAFE_PATTERNS.some((re) => re.test(t));
}
function gate(c: ConceptJSON): { status: "pass" | "needs_alternatives" | "reject"; reason: string } {
  if (
    unsafeText(c.hard_sell_opening) ||
    unsafeText(c.transformation_promise) ||
    unsafeText(c.value_proposition)
  ) return { status: "reject", reason: "Contains fake guarantee or unsafe claim." };
  if ((c.compliance_risk_score ?? 0) > TH.compliance_risk_reject) {
    return { status: "reject", reason: `compliance_risk=${c.compliance_risk_score}` };
  }
  const f: string[] = [];
  if (c.buyer_appeal_score < TH.buyer_appeal_min) f.push(`buyer_appeal=${c.buyer_appeal_score}`);
  if (c.premium_score < TH.premium_min) f.push(`premium=${c.premium_score}`);
  if (c.hard_sell_strength_score < TH.hard_sell_strength_min) f.push(`hard_sell=${c.hard_sell_strength_score}`);
  if (c.idea_score < TH.idea_min) f.push(`idea=${c.idea_score}`);
  if (c.compliance_risk_score > TH.compliance_risk_max) f.push(`compliance=${c.compliance_risk_score}`);
  if (f.length === 0) return { status: "pass", reason: "All thresholds met." };
  return { status: "needs_alternatives", reason: f.join(", ") };
}

// ---------- defensive validation ----------
function validateConcept(o: unknown): ConceptJSON {
  if (!o || typeof o !== "object") throw new Error("AI did not return an object");
  const x = o as Record<string, unknown>;
  const str = (k: string) => typeof x[k] === "string" ? (x[k] as string) : "";
  const num = (k: string) => {
    const n = Number(x[k]);
    return Number.isFinite(n) ? n : 0;
  };
  const oh = (x.objection_handling ?? {}) as Record<string, unknown>;
  const concept: ConceptJSON = {
    title: str("title").trim(),
    subtitle: str("subtitle").trim(),
    hook: str("hook").trim(),
    target_buyer: str("target_buyer").trim(),
    core_pain_point: str("core_pain_point").trim(),
    deeper_emotional_fear: str("deeper_emotional_fear").trim(),
    transformation_promise: str("transformation_promise").trim(),
    value_proposition: str("value_proposition").trim(),
    hard_sell_opening: str("hard_sell_opening").trim(),
    objection_handling: {
      too_expensive: typeof oh.too_expensive === "string" ? oh.too_expensive : "",
      not_for_me: typeof oh.not_for_me === "string" ? oh.not_for_me : "",
      free_info: typeof oh.free_info === "string" ? oh.free_info : "",
      no_time: typeof oh.no_time === "string" ? oh.no_time : "",
    },
    buyer_appeal_score: Math.max(0, Math.min(100, Math.round(num("buyer_appeal_score")))),
    premium_score: Math.max(0, Math.min(100, Math.round(num("premium_score")))),
    hard_sell_strength_score: Math.max(0, Math.min(100, Math.round(num("hard_sell_strength_score")))),
    compliance_risk_score: Math.max(1, Math.min(10, Math.round(num("compliance_risk_score") || 1))),
    idea_score: Math.max(0, Math.min(100, Math.round(num("idea_score")))),
    status: (["pass", "needs_alternatives", "reject"].includes(String(x.status))
      ? (x.status as ConceptJSON["status"])
      : "needs_alternatives"),
    compliance_notes: str("compliance_notes"),
  };
  if (!concept.title) throw new Error("AI returned empty title");
  if (!concept.hook) throw new Error("AI returned empty hook");
  if (!concept.target_buyer) throw new Error("AI returned empty target_buyer");
  return concept;
}

// ---------- prompts ----------
const SHAPE_DOC = `Return JSON in EXACTLY this shape (no extra fields, no markdown):
{
  "title": "premium, hard-sell, emotionally specific",
  "subtitle": "clarifies the transformation and who it's for",
  "hook": "one hard-sell sentence under 35 words",
  "target_buyer": "specific USA persona — age/role/situation",
  "core_pain_point": "concrete pain this PDF resolves",
  "deeper_emotional_fear": "identity-level fear behind the pain",
  "transformation_promise": "believable outcome, NEVER guaranteed",
  "value_proposition": "one sentence on why this beats free info",
  "hard_sell_opening": "2-3 sentences that make the buyer feel seen, no fake urgency, no fake scarcity, no fabricated proof",
  "objection_handling": {
    "too_expensive": "honest rebuttal",
    "not_for_me": "honest rebuttal",
    "free_info": "honest rebuttal",
    "no_time": "honest rebuttal"
  },
  "buyer_appeal_score": 0,
  "premium_score": 0,
  "hard_sell_strength_score": 0,
  "compliance_risk_score": 1,
  "idea_score": 0,
  "status": "pass | needs_alternatives | reject",
  "compliance_notes": "any compliance flags or hedges applied"
}

ETHICAL RULES (must follow):
- No fake guarantees or guaranteed outcomes (income, weight loss, legal wins, cures).
- No fake urgency, fake scarcity, fabricated stats, fabricated testimonials.
- American English. Educational tone for sensitive topics (finance, health, legal, relationships).
- compliance_risk_score is 1 (safest) to 10 (riskiest). Score honestly.
- If the topic forces unsafe claims, return status="reject" and explain in compliance_notes.`;

function buildOneBestPrompt(opts: {
  categoryName: string; categoryDescription: string; existingTitles: string;
}) {
  return `Generate ONE best sellable ebook concept. Output the strongest hard-sell version from the start — do NOT propose alternatives in this call.

Category: ${opts.categoryName} — ${opts.categoryDescription}
Planned price: $19–$29 · Length: ~18,000 words (70–90 page PDF)

AVOID titles already in the system:
${opts.existingTitles || "(none)"}

${SHAPE_DOC}`;
}

function buildAlternativesPrompt(opts: {
  categoryName: string;
  categoryDescription: string;
  parent: { title: string; subtitle?: string; hook?: string; target_buyer?: string; core_pain_point?: string };
  weakness: string;
  existingTitles: string;
}) {
  return `Generate EXACTLY TWO alternative concepts that are stronger than the original. Each alternative must be distinct from the other (different angle, different buyer identity, or different hook).

Original concept that was too weak:
- Title: ${opts.parent.title}
- Subtitle: ${opts.parent.subtitle ?? ""}
- Hook: ${opts.parent.hook ?? ""}
- Target buyer: ${opts.parent.target_buyer ?? ""}
- Core pain: ${opts.parent.core_pain_point ?? ""}
Reason it was too weak: ${opts.weakness}

Category: ${opts.categoryName} — ${opts.categoryDescription}
AVOID echoing existing titles:
${opts.existingTitles || "(none)"}

Return JSON in EXACTLY this shape:
{
  "alternative_a": { ...concept... },
  "alternative_b": { ...concept... }
}

Each concept follows this shape:
${SHAPE_DOC}`;
}

// ---------- persistence ----------
async function insertIdea(
  db: ReturnType<typeof admin>,
  args: {
    category_id: string | null;
    concept: ConceptJSON;
    generation_mode: "one_best" | "alternative";
    parent_idea_id: string | null;
    raw_ai: unknown;
    cost_usd: number;
  },
): Promise<string> {
  const { concept: c } = args;
  const gateResult = gate(c);
  const dbStatus = gateResult.status === "reject"
    ? "rejected"
    : gateResult.status === "pass"
    ? "idea"
    : "idea"; // needs_alternatives is still an idea row, just below threshold

  const { data, error } = await db.from("ebook_ideas").insert({
    category_id: args.category_id,
    title: c.title,
    subtitle: c.subtitle,
    hook: c.hook,
    target_buyer: c.target_buyer,
    core_pain_point: c.core_pain_point,
    deeper_emotional_fear: c.deeper_emotional_fear,
    transformation_promise: c.transformation_promise,
    value_proposition: c.value_proposition,
    hard_sell_opening: c.hard_sell_opening,
    objection_handling: c.objection_handling,
    buyer_appeal_score: c.buyer_appeal_score,
    premium_score: c.premium_score,
    hard_sell_strength_score: c.hard_sell_strength_score,
    hard_sell_score: c.hard_sell_strength_score, // keep legacy column populated
    compliance_risk_score: c.compliance_risk_score,
    idea_score: c.idea_score,
    total_score: c.idea_score,
    compliance_notes: c.compliance_notes,
    rejected_reason: gateResult.status === "reject" ? gateResult.reason : null,
    generation_mode: args.generation_mode,
    parent_idea_id: args.parent_idea_id,
    raw_ai: (args.raw_ai ?? {}) as Record<string, unknown>,
    scores: {
      buyer_appeal: c.buyer_appeal_score,
      premium: c.premium_score,
      hard_sell: c.hard_sell_strength_score,
      compliance_risk: c.compliance_risk_score,
      idea: c.idea_score,
    },
    status: dbStatus,
    cost_usd: args.cost_usd,
    notes: `[idea-copywriter:${args.generation_mode}] ${gateResult.status} — ${gateResult.reason}`,
  }).select("id").single();
  if (error) throw new Error(`insert failed: ${error.message}`);
  return data!.id as string;
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const mode: Mode = body.mode;
    if (mode !== "generate_one_best_concept" && mode !== "generate_two_alternatives") {
      return new Response(JSON.stringify({ error: "Invalid mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).maybeSingle();
    const aiMode = settings?.mode ?? "hybrid";
    const model = pickModel(aiMode, "marketing");

    // Existing titles to avoid (sample of recent 50)
    const { data: existing } = await db.from("ebook_ideas").select("title").order("created_at", { ascending: false }).limit(50);
    const existingTitles = (existing ?? []).map((r) => r.title).join("\n");

    if (mode === "generate_one_best_concept") {
      // Pick category
      let categoryId: string | null = body.category_id ?? null;
      if (!categoryId) {
        const enabled: string[] = settings?.enabled_category_ids ?? [];
        if (enabled.length > 0) {
          categoryId = enabled[Math.floor(Math.random() * enabled.length)];
        } else {
          const { data: any1 } = await db.from("categories").select("id").eq("enabled", true).limit(1).maybeSingle();
          categoryId = any1?.id ?? null;
        }
      }
      if (!categoryId) throw new Error("No categories available. Add one first.");
      const { data: cat } = await db.from("categories").select("name,description").eq("id", categoryId).single();

      const ai = await aiJSON<unknown>({
        system: HARDSELL_COPYWRITER_SYSTEM,
        user: buildOneBestPrompt({
          categoryName: cat?.name ?? "",
          categoryDescription: cat?.description ?? "",
          existingTitles,
        }),
        model,
      });
      await logCost(db, { idea_id: null, step: "idea-copywriter:one_best", model: ai.model, ...ai.usage });

      const concept = validateConcept(ai.data);
      const id = await insertIdea(db, {
        category_id: categoryId,
        concept,
        generation_mode: "one_best",
        parent_idea_id: null,
        raw_ai: ai.data,
        cost_usd: ai.usage.cost_usd,
      });

      return new Response(JSON.stringify({ mode, id, status: gate(concept).status, model, cost_usd: ai.usage.cost_usd }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // generate_two_alternatives
    const parentId = String(body.parent_idea_id ?? "");
    if (!parentId) throw new Error("parent_idea_id is required for alternatives mode");

    // Idempotency guard: never create more than two alternatives per parent.
    const { count: existingAltCount } = await db
      .from("ebook_ideas")
      .select("id", { count: "exact", head: true })
      .eq("parent_idea_id", parentId)
      .eq("generation_mode", "alternative");
    if ((existingAltCount ?? 0) >= 2) {
      throw new Error("Two alternatives already exist for this idea.");
    }

    const { data: parent, error: pErr } = await db.from("ebook_ideas")
      .select("id, category_id, title, subtitle, hook, target_buyer, core_pain_point, idea_score, buyer_appeal_score, premium_score, hard_sell_strength_score, compliance_risk_score, notes")
      .eq("id", parentId).single();
    if (pErr || !parent) throw new Error("Parent idea not found");

    const { data: cat } = parent.category_id
      ? await db.from("categories").select("name,description").eq("id", parent.category_id).single()
      : { data: null };

    const weakness = [
      parent.buyer_appeal_score != null ? `buyer_appeal=${parent.buyer_appeal_score}` : "",
      parent.premium_score != null ? `premium=${parent.premium_score}` : "",
      parent.hard_sell_strength_score != null ? `hard_sell=${parent.hard_sell_strength_score}` : "",
      parent.compliance_risk_score != null ? `compliance_risk=${parent.compliance_risk_score}` : "",
    ].filter(Boolean).join(", ") || "below quality threshold";

    const ai = await aiJSON<{ alternative_a?: unknown; alternative_b?: unknown }>({
      system: HARDSELL_COPYWRITER_SYSTEM,
      user: buildAlternativesPrompt({
        categoryName: cat?.name ?? "",
        categoryDescription: cat?.description ?? "",
        parent: {
          title: parent.title,
          subtitle: parent.subtitle ?? "",
          hook: parent.hook ?? "",
          target_buyer: parent.target_buyer ?? "",
          core_pain_point: parent.core_pain_point ?? "",
        },
        weakness,
        existingTitles,
      }),
      model,
    });
    await logCost(db, { idea_id: parentId, step: "idea-copywriter:alternatives", model: ai.model, ...ai.usage });

    const a = validateConcept(ai.data?.alternative_a);
    const b = validateConcept(ai.data?.alternative_b);
    if (a.title.toLowerCase() === b.title.toLowerCase()) {
      throw new Error("Alternatives returned identical titles; aborted.");
    }

    const idA = await insertIdea(db, {
      category_id: parent.category_id ?? null,
      concept: a,
      generation_mode: "alternative",
      parent_idea_id: parentId,
      raw_ai: ai.data?.alternative_a,
      cost_usd: ai.usage.cost_usd / 2,
    });
    const idB = await insertIdea(db, {
      category_id: parent.category_id ?? null,
      concept: b,
      generation_mode: "alternative",
      parent_idea_id: parentId,
      raw_ai: ai.data?.alternative_b,
      cost_usd: ai.usage.cost_usd / 2,
    });

    return new Response(JSON.stringify({
      mode, parent_idea_id: parentId, ids: [idA, idB], model, cost_usd: ai.usage.cost_usd,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
