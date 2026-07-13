// Premium Positioning — generates 10 premium variants for an existing idea plus a best-pick
// with storefront-ready metadata. Returns inline; admin applies one variant to the idea.
import { corsHeaders, admin, aiJSON, pickModel, logCost, requireAdmin } from "../_shared/ai.ts";

interface ValueBoosters {
  checklist: string; template: string; workbook: string;
  calculator: string; action_plan: string;
}
interface PremiumOption {
  premium_title: string;
  premium_subtitle: string;
  target_buyer: string;
  core_pain_point: string;
  premium_transformation_promise: string;
  perceived_value_boosters: ValueBoosters;
  primary_hook: string;
  buyer_appeal_score: number;
  premium_score: number;
  why_it_feels_premium: string;
}
interface StorefrontReady {
  product_title: string;
  meta_title: string;
  meta_description: string;
  url_handle: string;
  tags: string[];
}
interface BestChoice {
  premium_title: string;
  premium_subtitle: string;
  primary_hook: string;
  product_page_opening: string;
  recommended_category: string;
  recommended_price: string;
  buyer_appeal_score: number;
  premium_score: number;
  shopify_ready: StorefrontReady;
}
interface Diagnosis {
  why_ordinary: string;
  what_would_make_premium: string;
  best_buyer_emotion: string;
}
interface PremiumResult {
  premium_diagnosis: Diagnosis;
  options: PremiumOption[];
  best_final_choice: BestChoice;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { idea_id } = await req.json();
    if (!idea_id) throw new Error("idea_id required");

    const { data: idea, error } = await db.from("ebook_ideas").select("*").eq("id", idea_id).single();
    if (error || !idea) throw new Error("Idea not found");

    const { data: settings } = await db.from("generation_settings").select("mode").eq("id", 1).single();
    const { data: cat } = idea.category_id
      ? await db.from("categories").select("name,description").eq("id", idea.category_id).single()
      : { data: null };

    const model = pickModel(settings?.mode ?? "hybrid", "marketing");

    const sys = `You are a premium ebook positioning strategist for the USA digital product market.
You transform basic ebook topics into premium, high-value, commercially attractive PDF ebook concepts for American buyers of paid guides, playbooks, frameworks, protocols, templates, and workbooks.

Premium positioning rules:
1. Titles sound like a high-value system, framework, protocol, playbook, blueprint, method, toolkit, or field guide.
2. Avoid cheap, generic, beginner-level wording unless the buyer is truly beginner.
3. Replace broad words with precise buyer outcomes.
4. Make the topic feel specific to a high-intent buyer.
5. Add a clear transformation, not just information.
6. Make the buyer feel the ebook saves time, reduces confusion, prevents mistakes, or creates clarity.
7. Premium but simple American English.
8. Add perceived value through templates, checklists, worksheets, calculators, scripts, or action plans.
9. NO hype, fake guarantees, scammy wording, or unrealistic promises.
10. Feel like a useful paid asset, not a free blog post.

Upgrade weak wording: guide → playbook/field guide/operating system/framework · tips → system/checklist/protocol · basics → starter framework/clarity map/action plan · secrets → insider framework/hidden patterns/practical shortcuts · how to → the blueprint for/the framework for/the system to · easy → simple/low-friction · save money → reduce financial pressure/keep more of what you earn · make money → build income skills/create monetizable assets/develop earning systems · learn AI → build AI workflows/automate repeat tasks/create practical AI systems · productivity tips → focus operating system/time-control framework.

Premium title patterns to use:
1. The [Buyer Identity] [Outcome] Framework
2. The [Problem] Escape Plan
3. The [Outcome] Operating System
4. The [Buyer Identity] Playbook
5. The [Specific Result] Blueprint
6. The [Pain-Free Outcome] Protocol
7. The [Category] Clarity System
8. The [Risk Reduction] Field Guide
9. The [Transformation] Toolkit
10. The [High-Value Outcome] Method

Scoring (1-100):
- buyer_appeal_score: how likely the buyer wants it
- premium_score: how high-value and paid-product-worthy it feels
90-100 Featured · 80-89 Strong premium · 70-79 Good but needs improvement · 60-69 Too generic · <60 Reject.

Rules:
- American English. Never academic. Never sound like a cheap internet course. Titles concise.
- NO guaranteed income, savings, investment returns, weight loss, health, legal, or relationship outcomes.
- No medical/legal/financial advice language without educational framing.`;

    const user = `Transform this ebook into 10 premium positioning options, then pick the best one with storefront-ready metadata.

Category: ${cat?.name ?? "n/a"} — ${cat?.description ?? ""}
Planned price: $19–$29 · Planned word count: ~18,000 words (70–90 page PDF)

Raw Topic / Current state:
- Current Title: ${idea.title}
- Current Subtitle: ${idea.subtitle ?? ""}
- Current Hook: ${idea.hook ?? ""}
- Target Buyer: ${idea.target_buyer ?? ""}
- Current pain point: ${idea.core_pain_point ?? ""}
- Current transformation: ${idea.transformation_promise ?? ""}

Use a DIFFERENT premium title pattern for each of the 10 options. Make each option meaningfully distinct (different buyer angle, different transformation, different value boosters).

Return JSON exactly in this shape:
{
  "premium_diagnosis": {
    "why_ordinary": "...",
    "what_would_make_premium": "...",
    "best_buyer_emotion": "..."
  },
  "options": [
    {
      "premium_title": "...",
      "premium_subtitle": "...",
      "target_buyer": "...",
      "core_pain_point": "...",
      "premium_transformation_promise": "...",
      "perceived_value_boosters": {
        "checklist": "...", "template": "...", "workbook": "...",
        "calculator": "...", "action_plan": "..."
      },
      "primary_hook": "...",
      "buyer_appeal_score": 1-100,
      "premium_score": 1-100,
      "why_it_feels_premium": "..."
    }
    // ... exactly 10 options ...
  ],
  "best_final_choice": {
    "premium_title": "...",
    "premium_subtitle": "...",
    "primary_hook": "...",
    "product_page_opening": "2-3 sentence opening for the storefront product page",
    "recommended_category": "${cat?.name ?? ""}",
    "recommended_price": "$19 | $24 | $29",
    "buyer_appeal_score": 1-100,
    "premium_score": 1-100,
    "shopify_ready": {
      "product_title": "concise product title for storefront",
      "meta_title": "<= 60 chars SEO title",
      "meta_description": "<= 160 chars SEO description",
      "url_handle": "kebab-case-url-handle",
      "tags": ["tag1","tag2","tag3","tag4","tag5"]
    }
  }
}`;

    const ai = await aiJSON<PremiumResult>({ system: sys, user, model });
    await logCost(db, { idea_id: idea.id, step: "premium-positioning", model: ai.model, ...ai.usage });

    return new Response(JSON.stringify({
      ok: true,
      idea_id,
      result: ai.data,
      cost_usd: ai.usage.cost_usd,
      model: ai.model,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
