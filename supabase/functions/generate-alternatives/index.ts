// Generate exactly TWO stronger alternatives for an existing weak idea,
// plus an AI-recommended winner with Shopify-ready metadata.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { HARDSELL_COPYWRITER_SYSTEM } from "../_shared/prompts.ts";

interface Alt {
  title: string; subtitle: string; hook: string;
  core_pain_point: string; cost_of_doing_nothing: string;
  transformation_promise: string; product_page_opening: string;
  why_stronger: string;
  buyer_appeal_score: number; premium_score: number;
  hard_sell_strength_score: number; compliance_risk_score: number; idea_score: number;
}
interface Winner {
  selected_option: "A" | "B";
  title: string; subtitle: string; hook: string; product_page_opening: string;
  shopify_product_title: string; meta_title: string; meta_description: string;
  url_handle: string; tags: string[];
  final_buyer_appeal_score: number; final_premium_score: number;
  final_hard_sell_strength_score: number;
  final_compliance_risk_score: number; final_idea_score: number;
  status: string; recommended_admin_action: string;
}
interface AltResult {
  previous_title: string;
  reason_current_version_is_not_strong_enough: string;
  alternative_a: Alt;
  alternative_b: Alt;
  ai_recommended_winner: Winner;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id, admin_feedback } = await req.json();
    if (!idea_id) throw new Error("idea_id required");

    const { data: idea, error } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
    if (error || !idea) throw new Error("Idea not found");

    const { data: settings } = await db.from("generation_settings").select("mode").eq("id", 1).single();
    const { data: cat } = idea.category_id
      ? await db.from("categories").select("name,description").eq("id", idea.category_id).single()
      : { data: null };

    const model = pickModel(settings?.mode ?? "hybrid", "marketing");

    const sys = HARDSELL_COPYWRITER_SYSTEM + `\n\nThis call asks you to produce EXACTLY 2 stronger hard-sell alternatives to a weak idea, plus an AI-picked winner with Shopify-ready metadata. Each option must beat the current version on buyer identity, pain naming, emotional hook, premium feeling, hard-sell strength, and Shopify positioning.

Status rules for the recommended winner:
- Appeal>=85 AND Premium>=85 AND HardSell>=85 AND Compliance<=3 → "Premium Featured / Ready to Generate"
- Appeal>=80 AND Premium>=80 AND HardSell>=80 AND Compliance<=4 → "Approved / Ready to Generate"
- else → "Needs Rewrite"`;

    const scores = (idea.scores ?? {}) as Record<string, number>;
    const user = `Input:
Current Title: ${idea.title}
Current Subtitle: ${idea.subtitle ?? ""}
Current Hook: ${idea.hook ?? ""}
Category: ${cat?.name ?? ""} — ${cat?.description ?? ""}
Target Buyer: ${idea.target_buyer ?? ""}
Core Pain Point: ${idea.core_pain_point ?? ""}
Current Buyer Appeal Score: ${scores.buyer_appeal ?? "n/a"}
Current Premium Score: ${scores.premium ?? "n/a"}
Current Hard-Sell Strength Score: ${scores.hard_sell ?? "n/a"}
Current Compliance Risk Score: ${scores.compliance_risk ?? "n/a"}
Admin Feedback: ${admin_feedback ?? "(none)"}

Return JSON in EXACTLY this shape:
{
  "previous_title": "",
  "reason_current_version_is_not_strong_enough": "",
  "alternative_a": {
    "title": "", "subtitle": "", "hook": "",
    "core_pain_point": "", "cost_of_doing_nothing": "",
    "transformation_promise": "", "product_page_opening": "",
    "why_stronger": "",
    "buyer_appeal_score": 0, "premium_score": 0,
    "hard_sell_strength_score": 0, "compliance_risk_score": 0, "idea_score": 0
  },
  "alternative_b": {
    "title": "", "subtitle": "", "hook": "",
    "core_pain_point": "", "cost_of_doing_nothing": "",
    "transformation_promise": "", "product_page_opening": "",
    "why_stronger": "",
    "buyer_appeal_score": 0, "premium_score": 0,
    "hard_sell_strength_score": 0, "compliance_risk_score": 0, "idea_score": 0
  },
  "ai_recommended_winner": {
    "selected_option": "A or B",
    "title": "", "subtitle": "", "hook": "", "product_page_opening": "",
    "shopify_product_title": "", "meta_title": "", "meta_description": "",
    "url_handle": "", "tags": ["", "", "", ""],
    "final_buyer_appeal_score": 0, "final_premium_score": 0,
    "final_hard_sell_strength_score": 0,
    "final_compliance_risk_score": 0, "final_idea_score": 0,
    "status": "Premium Featured / Ready to Generate | Approved / Ready to Generate | Needs Rewrite",
    "recommended_admin_action": "Approve & Generate | Rewrite | Reject"
  }
}`;

    const ai = await aiJSON<AltResult>({ system: sys, user, model });
    await logCost(db, { idea_id, step: "generate-alternatives", model: ai.model, ...ai.usage });

    return new Response(JSON.stringify({ ok: true, idea_id, result: ai.data, cost_usd: ai.usage.cost_usd, model: ai.model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
