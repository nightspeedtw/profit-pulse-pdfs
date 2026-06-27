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

    const sys = `You are a premium ebook editor. You raise buyer-appeal scores by making promises more specific, urgent, and honest. NEVER use medical claims, "guaranteed results", or get-rich-quick language.`;
    const user = `Improve this ebook idea so the buyer-appeal score rises above 75/100.

Category: ${cat?.name ?? "n/a"} — ${cat?.description ?? ""}

Current:
- Title: ${idea.title}
- Subtitle: ${idea.subtitle ?? ""}
- Target buyer: ${idea.target_buyer ?? ""}
- Hook: ${idea.hook ?? ""}
- Current score: ${idea.total_score}/60 (raw)

${focus}

Re-score honestly across 6 dimensions (1-10 each): urgency, transformation, commercial, evergreen, emotional, clarity.

Return JSON: {
  "title": "...", "subtitle": "...", "target_buyer": "...", "hook": "...",
  "scores": { "urgency": n, "transformation": n, "commercial": n, "evergreen": n, "emotional": n, "clarity": n },
  "rationale": "one sentence on what you changed and why it lifts the score"
}`;

    const ai = await aiJSON<Improved>({ system: sys, user, model });
    await logCost(db, { idea_id: idea.id, step: `improve-idea:${mode_action}`, model: ai.model, ...ai.usage });

    const s = ai.data.scores;
    const total = s.urgency + s.transformation + s.commercial + s.evergreen + s.emotional + s.clarity;
    const prevHistory = (idea.notes ? `${idea.notes}\n--\n` : "");

    await db.from("ebook_ideas").update({
      title: ai.data.title,
      subtitle: ai.data.subtitle,
      target_buyer: ai.data.target_buyer,
      hook: ai.data.hook,
      scores: s,
      total_score: total,
      status: "idea",
      notes: prevHistory + `[improve:${mode_action}] ${ai.data.rationale}`,
    }).eq("id", idea.id);

    return new Response(JSON.stringify({ ok: true, total_score: total, score_100: Math.round(total / 60 * 100) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
