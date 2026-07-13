// Generate ONE best sellable ebook concept per call using the
// "Premium Title & Hard-Sell Copywriter" agent. One pass = one strongest version.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";
import { HARDSELL_COPYWRITER_SYSTEM } from "../_shared/prompts.ts";
import { checkPremiumTitle } from "../_shared/title-guard.ts";

const MAX_TITLE_ATTEMPTS = 5;

interface ObjectionHandling {
  too_expensive: string;
  not_for_me: string;
  i_can_find_free_info: string;
  i_do_not_have_time: string;
}
interface BestConcept {
  title: string;
  subtitle: string;
  primary_hook: string;
  hard_sell_opening: string;
  buyer_identity: string;
  core_pain_point: string;
  deeper_emotional_fear: string;
  cost_of_doing_nothing: string;
  transformation_promise: string;
  value_proposition: string;
  objection_handling: ObjectionHandling;
  perceived_value_boosters: string[];
  why_it_sells: string;
  buyer_appeal_score: number;
  premium_score: number;
  hard_sell_strength_score: number;
  compliance_risk_score: number;
  idea_score: number;
  status: string;
  recommended_admin_action: string;
}
interface StorefrontReady {
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
  shopify_ready: StorefrontReady;
}

function mapStatus(s: string): "idea" | "rejected" {
  const v = (s ?? "").toLowerCase();
  if (v.includes("reject")) return "rejected";
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
    const sys = HARDSELL_COPYWRITER_SYSTEM;

    const userTemplate = `Generate ONE best sellable ebook concept for this category. Output the strongest hard-sell version from the start — do not propose alternatives.

Category: ${cat?.name ?? ""} — ${cat?.description ?? ""}
Planned price: $19–$29 · Planned word count: ~18,000 words (70–90 page PDF)

AVOID titles already in the system (do not repeat or closely echo any of these):
${existingTitles}

Return JSON in EXACTLY this shape:
{
  "category": "${cat?.name ?? ""}",
  "raw_topic": "the practical topic this ebook covers",
  "target_buyer": "specific USA persona — age/role/situation/income band",
  "best_sellable_concept": {
    "title": "hard-sell, emotionally specific, premium",
    "subtitle": "clarifies the transformation and who it's for",
    "primary_hook": "one hard-sell sentence under 35 words",
    "hard_sell_opening": "2-3 sentence opening that makes the buyer feel seen",
    "buyer_identity": "the identity label the buyer uses for themselves",
    "core_pain_point": "the concrete pain this PDF resolves",
    "deeper_emotional_fear": "the deeper identity-level fear behind the pain",
    "cost_of_doing_nothing": "what continues to get worse if they don't act",
    "transformation_promise": "what they will be able to do after reading — believable, not guaranteed",
    "value_proposition": "one sentence on why this beats free information",
    "objection_handling": {
      "too_expensive": "honest rebuttal",
      "not_for_me": "honest rebuttal",
      "i_can_find_free_info": "honest rebuttal",
      "i_do_not_have_time": "honest rebuttal"
    },
    "perceived_value_boosters": ["checklist name", "template name", "workbook name", "action plan name"],
    "why_it_sells": "1-2 sentences on commercial appeal",
    "buyer_appeal_score": 1-100,
    "premium_score": 1-100,
    "hard_sell_strength_score": 1-100,
    "compliance_risk_score": 1-10,
    "idea_score": 1-100,
    "status": "Premium Featured / Ready to Generate | Approved / Ready to Generate | Needs Rewrite",
    "recommended_admin_action": "Approve & Generate | Rewrite | Reject"
  },
  "shopify_ready": {
    "product_title": "concise storefront product title",
    "meta_title": "<= 60 chars SEO title",
    "meta_description": "<= 160 chars SEO description",
    "url_handle": "kebab-case-url-handle",
    "tags": ["tag1","tag2","tag3","tag4"],
    "recommended_price": "$19 | $24 | $29",
    "recommended_category": "${cat?.name ?? ""}"
  }
}`;

    const created: string[] = [];
    let totalCost = 0;

    for (let i = 0; i < requestedCount; i++) {
      let accepted: OneIdea | null = null;
      let lastReasons: string[] = [];
      let attemptCost = 0;

      for (let attempt = 1; attempt <= MAX_TITLE_ATTEMPTS; attempt++) {
        try {
          const feedback = lastReasons.length
            ? `\n\nPREVIOUS ATTEMPT REJECTED by the Premium Title Guard for: ${lastReasons.join(", ")}. Rewrite using one of the REQUIRED PATTERNS. Do NOT use "How to …", generic guides, "Tips/Tricks/Advice", or blog-post phrasing.`
            : "";
          const ai = await aiJSON<OneIdea>({ system: sys, user: userTemplate + feedback, model });
          attemptCost += ai.usage.cost_usd;
          await logCost(db, { idea_id: null, step: "generate-idea", model: ai.model, ...ai.usage });

          const c = ai.data.best_sellable_concept;
          if (!c?.title) { lastReasons = ["empty_title"]; continue; }

          const check = checkPremiumTitle(c.title);
          if (!check.ok) {
            lastReasons = check.reasons;
            continue;
          }
          accepted = ai.data;
          break;
        } catch (_e) {
          lastReasons = ["ai_error"];
        }
      }
      totalCost += attemptCost;
      if (!accepted) continue;

      const c = accepted.best_sellable_concept;
      const shop = accepted.shopify_ready ?? {} as ShopifyReady;
      const status = mapStatus(c.status);
      const scoreVal = Math.max(0, Math.min(100, Number(c.idea_score ?? 0)));

      const { data: row } = await db.from("ebook_ideas").insert({
        category_id: categoryId,
        title: c.title,
        subtitle: c.subtitle,
        target_buyer: accepted.target_buyer,
        hook: c.primary_hook,
        scores: {
          buyer_appeal: c.buyer_appeal_score,
          premium: c.premium_score,
          hard_sell: c.hard_sell_strength_score,
          compliance_risk: c.compliance_risk_score,
          idea: c.idea_score,
        },
        total_score: scoreVal,
        status,
        notes: `[hard-sell-copywriter] ${c.status} — ${c.recommended_admin_action}`,
        cost_usd: attemptCost,
        core_pain_point: c.core_pain_point,
        deeper_emotional_fear: c.deeper_emotional_fear,
        transformation_promise: c.transformation_promise,
        perceived_value_boosters: c.perceived_value_boosters ?? [],
        why_it_sells: c.why_it_sells,
        recommended_action: c.recommended_admin_action,
        improvement_round: 1,
        raw_title: c.title,
        raw_subtitle: c.subtitle,
        raw_hook: c.primary_hook,
        raw_target_buyer: accepted.target_buyer,
        buyer_identity: c.buyer_identity,
        cost_of_doing_nothing: c.cost_of_doing_nothing,
        value_proposition: c.value_proposition,
        hard_sell_opening: c.hard_sell_opening,
        objection_handling: c.objection_handling ?? {},
        shopify_meta: shop,
      }).select("id").single();
      if (row?.id) created.push(row.id);
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
