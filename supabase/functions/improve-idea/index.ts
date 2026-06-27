// Admin "Improve Again" — runs a stronger second-pass (or n-th pass) improvement on an idea.
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";
import { improveIdea, applyImprovement, statusForScore, type ImproveAction } from "../_shared/improve.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id, action, admin_feedback } = await req.json();
    if (!idea_id) throw new Error("idea_id required");
    const mode_action: ImproveAction = (action === "title" || action === "hook") ? action : "all";

    const { data: idea, error } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
    if (error || !idea) throw new Error("Idea not found");

    const { data: settings } = await db.from("generation_settings").select("mode").eq("id", 1).single();
    const { data: cat } = idea.category_id
      ? await db.from("categories").select("name,description").eq("id", idea.category_id).single()
      : { data: null };

    const result = await improveIdea({
      id: idea.id,
      title: idea.title,
      subtitle: idea.subtitle,
      target_buyer: idea.target_buyer,
      hook: idea.hook,
      total_score: idea.total_score,
      category: cat,
      admin_feedback: admin_feedback ?? null,
      round: idea.improvement_round ?? 0,
      action: mode_action,
      mode: settings?.mode ?? "hybrid",
    });

    await applyImprovement(db, idea.id, {
      title: idea.title, subtitle: idea.subtitle, hook: idea.hook, target_buyer: idea.target_buyer,
      raw_title: idea.raw_title, improvement_round: idea.improvement_round ?? 0, notes: idea.notes,
    }, result, { source: "improve-again", action: mode_action, admin_feedback: admin_feedback ?? null });

    const meta = statusForScore(result.score_100);
    return new Response(JSON.stringify({
      ok: true, total_score: result.total_score, score_100: result.score_100,
      status_hint: meta.status, recommended_action: result.improved.recommended_action,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
