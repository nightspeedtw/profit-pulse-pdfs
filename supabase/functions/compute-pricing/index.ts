// compute-pricing
// POST { ebook_id }  → computes the Automatic Psychological Pricing report,
// writes pricing_report + price columns on the ebook, returns the report.
import { admin, corsHeaders } from "../_shared/ai.ts";
import { logRun } from "../_shared/qc.ts";
import { computePricing, type PricingInputs } from "../_shared/pricing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const db = admin();
  try {
    const body = await req.json().catch(() => ({}));
    const ebookId: string | undefined = body.ebook_id;
    const isBundle: boolean = !!body.is_bundle;
    if (!ebookId) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error } = await db.from("ebooks").select("*").eq("id", ebookId).maybeSingle();
    if (error || !ebook) return json({ error: "ebook not found" }, 404);

    // Pull category + idea signals.
    let categorySlug: string | null = null;
    let categoryName: string | null = null;
    if (ebook.category_id) {
      const { data: cat } = await db.from("categories").select("slug,name").eq("id", ebook.category_id).maybeSingle();
      categorySlug = cat?.slug ?? null;
      categoryName = cat?.name ?? null;
    }
    let idea: any = null;
    if (ebook.idea_id) {
      const { data } = await db.from("ebook_ideas").select("*").eq("id", ebook.idea_id).maybeSingle();
      idea = data;
    }

    // Map signals → pricing inputs (best-effort, missing fields fall back to medium defaults).
    const inputs: PricingInputs = {
      title: ebook.title,
      category_slug: categorySlug,
      category_name: categoryName,
      target_buyer: ebook.target_buyer ?? idea?.target_buyer,
      buyer_pain_level: pickScore(idea?.buyer_pain_score, idea?.pain_level),
      buyer_urgency: pickScore(idea?.buyer_urgency_score, idea?.urgency),
      buyer_ability_to_pay: pickScore(idea?.buyer_ability_to_pay_score, idea?.ability_to_pay),
      topic_demand: pickScore(idea?.topic_demand_score, idea?.market_demand_score),
      market_competition: pickScore(idea?.market_competition_score, idea?.competition_score),
      word_count: ebook.total_word_count ?? ebook.word_count,
      page_count: ebook.page_count,
      chapter_count: Array.isArray(ebook.chapters) ? ebook.chapters.length : ebook.chapter_count,
      worksheet_count: ebook.worksheet_count,
      template_count: ebook.template_count,
      diagram_count: ebook.diagram_count,
      bonus_asset_count: ebook.bonus_asset_count,
      premium_score: ebook.final_quality_score ?? ebook.premium_score ?? idea?.premium_score,
      conversion_score: ebook.conversion_score,
      cover_score: ebook.cover_score ?? ebook.thumbnail_score,
      compliance_risk_score: ebook.compliance_safety_score != null
        ? Math.max(0, 10 - Math.round((ebook.compliance_safety_score ?? 100) / 10))
        : idea?.compliance_risk_score,
      refund_risk_score: ebook.refund_risk_score ?? idea?.refund_risk_score,
      is_bundle: isBundle,
      comparable_market_price_range: parseRange(ebook.market_price_range) ?? parseRange(idea?.comparable_market_price_range),
    };

    const report = computePricing(inputs);

    const updates: Record<string, unknown> = {
      pricing_report: report,
      recommended_price: Number(report.recommended_price),
      launch_price: Number(report.launch_price),
      standard_price: Number(report.standard_price),
      low_price_test: Number(report.low_price_test),
      high_price_test: Number(report.high_price_test),
      bundle_price_recommendation: Number(report.bundle_price_recommendation),
      pricing_tier: report.pricing_tier,
      price_confidence_score: report.price_confidence_score,
      pricing_computed_at: new Date().toISOString(),
      // Set the live price to the recommended (standard) unless explicitly in launch mode.
      price: Number(body.use_launch_price ? report.launch_price : report.recommended_price),
    };
    await db.from("ebooks").update(updates).eq("id", ebookId);

    await logRun(db, {
      ebook_id: ebookId, step: "pricing", status: "ok",
      duration_ms: Date.now() - t0,
      payload: {
        recommended_price: report.recommended_price,
        pricing_tier: report.pricing_tier,
        confidence: report.price_confidence_score,
      },
    });

    return json({ ok: true, report });
  } catch (e) {
    console.error("compute-pricing failed:", e);
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});

function pickScore(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) {
      // Normalize 0–100 → 0–10 if it looks like a 100-scale score.
      return n > 10 ? Math.round(n / 10) : n;
    }
  }
  return null;
}
function parseRange(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length === 2) {
    const a = Number(v[0]); const b = Number(v[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
  }
  if (typeof v === "string") {
    const m = v.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
    if (m) return [Number(m[1]), Number(m[2])];
  }
  return null;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
