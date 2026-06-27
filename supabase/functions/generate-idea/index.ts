// Generate ONE best sellable ebook concept per call (premium positioning from the start).
// Loops `count` times so each idea is independently the strongest commercial version.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";

interface BestConcept {
  title: string;
  subtitle: string;
  hook: string;
  core_pain_point: string;
  deeper_emotional_fear: string;
  transformation_promise: string;
  product_page_opening: string;
  perceived_value_boosters: string[];
  why_it_sells: string;
  buyer_appeal_score: number;
  premium_score: number;
  compliance_risk_score: number;
  idea_score: number;
  status: string;
  recommended_admin_action: string;
}
interface ShopifyReady {
  product_title: string;
  meta_title: string;
  meta_description: string;
  url_handle: string;
  tags: string[];
  recommended_price: string;
  recommended_category: string;
}
interface OneIdea {
  raw_topic: string;
  category: string;
  target_buyer: string;
  best_sellable_concept: BestConcept;
  shopify_ready: ShopifyReady;
}

function mapStatus(s: string): "idea" | "rejected" {
  const v = (s ?? "").toLowerCase();
  if (v.includes("regenerat") || v.includes("reject")) return "rejected";
  return "idea";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const requestedCount: number = Math.min(Math.max(Number(body.count ?? 1), 1), 10);

    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).single();
    const mode = settings?.mode ?? "hybrid";

    // Pick a category (round-robin among enabled)
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
    const { data: cat } = await db.from("categories").select("*").eq("id", categoryId).single();

    const { data: existing } = await db.from("ebook_ideas").select("title").order("created_at", { ascending: false }).limit(50);
    const existingTitles = (existing ?? []).map((r) => r.title).join("\n");

    const model = pickModel(mode, "marketing");

    const sys = `You are the best premium ebook title copywriter and product positioning strategist for the USA digital product market.

Your task is to generate only ONE best sellable ebook concept from the beginning.

Do not generate multiple options. Do not generate rough drafts. Do not generate generic blog-style titles. Your first output must be the strongest commercial version you can create.

The ebook will be sold as a premium PDF product on Shopify.

Target market: USA buyers who purchase premium PDF ebooks, guides, frameworks, protocols, playbooks, templates, workbooks, and digital products.

The title must feel: Premium, Practical, Clear, Emotionally compelling, Commercially attractive, Worth paying for, Specific to the target buyer, Strong enough to approve without needing another improvement round.

Use buyer psychology: relief from specific pain · clarity when overwhelmed · control when life feels uncertain · systems that reduce decision fatigue · protection for family/money/health/career/future · shortcuts that save time · products that feel made for their exact identity · titles that make the buyer feel seen.

Use premium product language when appropriate: Framework, Protocol, Blueprint, Playbook, Operating System, Toolkit, Field Guide, Method, System, Safety Plan, Reset Plan, Cash Flow System, Wealth Framework, Career Playbook, AI Workflow System.

Rules:
- Generate only ONE best title. Not 2, not 5, not 10.
- No fake guarantees. No guaranteed income, savings, investment returns, health/legal/relationship outcomes.
- Not scammy. Not academic. Not a free blog post. Avoid weak words (tips, tricks, basic guide, easy hacks).
- American English.
- If finance, investment, health, legal, or relationship related: keep wording educational and compliance-safe.

Scoring (1-100):
- buyer_appeal_score: how likely the target buyer wants this.
- premium_score: how high-value and paid-product-worthy it feels.
- compliance_risk_score: 1 safest, 10 risky.
- idea_score: combined commercial score.

Approval rules:
- buyer_appeal >= 85 AND premium >= 85 AND compliance <= 3 → "Premium Featured / Ready to Generate"
- buyer_appeal >= 80 AND premium >= 80 AND compliance <= 4 → "Approved / Ready to Generate"
- buyer_appeal >= 70 OR premium >= 70 → "Needs Admin Review"
- else → "Needs Regeneration"

Output must be valid JSON only. Do not include any text before or after the JSON.`;

    const userTemplate = `Input:
Category: ${cat?.name ?? ""} — ${cat?.description ?? ""}
Raw Topic: pick the highest-commercial-value topic in this category that has NOT been used below.
Target Buyer: define a specific USA buyer persona for this concept.
Buyer Pain Point: define the most urgent, specific pain.
Planned Price: $19–$29
Planned Word Count: ~18,000 words (70–90 page PDF)

AVOID titles already in the system (do not repeat or closely echo any of these):
${existingTitles}

Return JSON in EXACTLY this shape:
{
  "raw_topic": "",
  "category": "${cat?.name ?? ""}",
  "target_buyer": "",
  "best_sellable_concept": {
    "title": "",
    "subtitle": "",
    "hook": "",
    "core_pain_point": "",
    "deeper_emotional_fear": "",
    "transformation_promise": "",
    "product_page_opening": "",
    "perceived_value_boosters": ["", "", ""],
    "why_it_sells": "",
    "buyer_appeal_score": 0,
    "premium_score": 0,
    "compliance_risk_score": 0,
    "idea_score": 0,
    "status": "Premium Featured / Ready to Generate | Approved / Ready to Generate | Needs Admin Review | Needs Regeneration",
    "recommended_admin_action": "Approve & Generate | Generate 2 Alternatives | Reject"
  },
  "shopify_ready": {
    "product_title": "",
    "meta_title": "",
    "meta_description": "",
    "url_handle": "",
    "tags": ["", "", "", ""],
    "recommended_price": "",
    "recommended_category": "${cat?.name ?? ""}"
  }
}`;

    const created: string[] = [];
    let totalCost = 0;

    for (let i = 0; i < requestedCount; i++) {
      try {
        const ai = await aiJSON<OneIdea>({ system: sys, user: userTemplate, model });
        totalCost += ai.usage.cost_usd;
        await logCost(db, { idea_id: null, step: "generate-idea", model: ai.model, ...ai.usage });

        const c = ai.data.best_sellable_concept;
        const shop = ai.data.shopify_ready ?? {} as ShopifyReady;
        if (!c?.title) continue;

        const status = mapStatus(c.status);
        const scoreVal = Math.max(0, Math.min(100, Number(c.idea_score ?? 0)));

        const { data: row } = await db.from("ebook_ideas").insert({
          category_id: categoryId,
          title: c.title,
          subtitle: c.subtitle,
          target_buyer: ai.data.target_buyer,
          hook: c.hook,
          scores: {
            buyer_appeal: c.buyer_appeal_score,
            premium: c.premium_score,
            compliance_risk: c.compliance_risk_score,
            idea: c.idea_score,
          },
          total_score: scoreVal,
          status,
          notes: `[one-shot-premium] ${c.status} — ${c.recommended_admin_action}\n${c.product_page_opening ?? ""}\n\nShopify: ${JSON.stringify(shop)}`,
          cost_usd: ai.usage.cost_usd,
          core_pain_point: c.core_pain_point,
          deeper_emotional_fear: c.deeper_emotional_fear,
          transformation_promise: c.transformation_promise,
          perceived_value_boosters: c.perceived_value_boosters ?? [],
          why_it_sells: c.why_it_sells,
          recommended_action: c.recommended_admin_action,
          improvement_round: 1,
          raw_title: c.title,
          raw_subtitle: c.subtitle,
          raw_hook: c.hook,
          raw_target_buyer: ai.data.target_buyer,
        }).select("id").single();
        if (row?.id) created.push(row.id);
      } catch (_e) {
        // continue — partial batch is acceptable
      }
    }

    return new Response(JSON.stringify({ created: created.length, ids: created, model, cost_usd: totalCost }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
