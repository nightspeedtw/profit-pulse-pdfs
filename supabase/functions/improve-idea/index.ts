// Improves an existing idea — rewrite title, hook, or full concept to lift buyer-appeal score.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";

interface Scores { urgency: number; transformation: number; commercial: number; evergreen: number; emotional: number; clarity: number }
interface ValueBoosters {
  checklist: string; template: string; workbook: string; calculator: string; action_plan: string;
}
interface Improved {
  title: string; subtitle: string; target_buyer: string; hook: string;
  pain_point: string; emotional_fear: string; transformation: string;
  value_boosters: ValueBoosters; why_it_sells: string;
  scores: Scores; rationale: string;
  recommended_action: "Generate Ebook" | "Improve Again" | "Reject";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id, action } = await req.json();
    if (!idea_id) throw new Error("idea_id required");
    const mode_action: "all" | "title" | "hook" = (action === "title" || action === "hook") ? action : "all";

    const { data: idea, error } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
    if (error || !idea) throw new Error("Idea not found");

    const { data: settings } = await db.from("generation_settings").select("mode").eq("id", 1).single();
    const { data: cat } = idea.category_id
      ? await db.from("categories").select("*").eq("id", idea.category_id).single()
      : { data: null };

    const model = pickModel(settings?.mode ?? "hybrid", "marketing");

    const focus = mode_action === "title"
      ? "Rewrite ONLY the title to be more specific, benefit-driven, and curiosity-inducing. Keep subtitle/hook the same unless minor polish is required."
      : mode_action === "hook"
      ? "Rewrite ONLY the hook to be more urgent and emotional, with a clear transformation. Keep title/subtitle the same."
      : "Improve every field: sharper title, more urgent pain in the subtitle, clearer transformation, stronger hook. Add specifics (numbers, timeframes, named outcomes) when honest.";

    const sys = `You are an expert USA ebook product strategist and ethical direct-response copywriter.

Your task is to transform a raw ebook idea into a premium, emotionally compelling, commercially sellable PDF ebook concept for American buyers.

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

    const user = `Improve this ebook idea so the buyer-appeal score rises above 75/100.

Category: ${cat?.name ?? "n/a"} — ${cat?.description ?? ""}
Planned price: $19–$29 · Planned word count: ~18,000 words (70–90 page PDF)

Raw Ebook Idea:
- Title: ${idea.title}
- Subtitle: ${idea.subtitle ?? ""}
- Target buyer: ${idea.target_buyer ?? ""}
- Hook: ${idea.hook ?? ""}
- Current score: ${idea.total_score}/60 (raw)

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

    const ai = await aiJSON<Improved>({ system: sys, user, model });
    await logCost(db, { idea_id: idea.id, step: `improve-idea:${mode_action}`, model: ai.model, ...ai.usage });

    const s = ai.data.scores;
    const total = s.urgency + s.transformation + s.commercial + s.evergreen + s.emotional + s.clarity;
    const score100 = Math.round(total / 60 * 100);
    const prevHistory = (idea.notes ? `${idea.notes}\n--\n` : "");
    const vb = ai.data.value_boosters ?? {} as ValueBoosters;
    const breakdown = [
      `[improve:${mode_action}] score ${score100}/100 — ${ai.data.rationale}`,
      `Pain: ${ai.data.pain_point ?? ""}`,
      `Fear: ${ai.data.emotional_fear ?? ""}`,
      `Transformation: ${ai.data.transformation ?? ""}`,
      `Value boosters: Checklist — ${vb.checklist ?? "—"}; Template — ${vb.template ?? "—"}; Workbook — ${vb.workbook ?? "—"}; Calculator — ${vb.calculator ?? "—"}; Action Plan — ${vb.action_plan ?? "—"}`,
      `Why it sells: ${ai.data.why_it_sells ?? ""}`,
      `Recommended action: ${ai.data.recommended_action ?? "Improve Again"}`,
    ].join("\n");

    await db.from("ebook_ideas").update({
      title: ai.data.title,
      subtitle: ai.data.subtitle,
      target_buyer: ai.data.target_buyer,
      hook: ai.data.hook,
      scores: s,
      total_score: total,
      status: "idea",
      notes: prevHistory + breakdown,
    }).eq("id", idea.id);

    return new Response(JSON.stringify({ ok: true, total_score: total, score_100: score100, recommended_action: ai.data.recommended_action }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
