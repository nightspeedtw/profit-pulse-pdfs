// Regenerate strong selling copy for an ebook: hook, product description, and
// benefit bullets. Called by auto-list-ebook whenever a product goes live,
// and by admins from the Live Production Queue.
import { corsHeaders, admin, aiJSON, logCost, requireAdmin } from "../_shared/ai.ts";

interface SellingCopy {
  selling_hook: string;
  product_description: string;
  benefit_bullets: string[];
}

const SYSTEM = `You are a world-class direct-response copywriter for Thai digital ebooks sold on a native storefront.
Your job: write short, punchy, high-converting sales copy in THAI that matches the book's psychological lever
(Control · Pain Relief · Identity · Status · Certainty · Belonging).

RULES:
- Speak directly to the buyer's pain and the transformation they want.
- Use curiosity, urgency, and specificity. No vague fluff. No generic ebook marketing lines.
- Never invent guaranteed income, health, or legal outcomes.
- No emojis. No hashtags. No exclamation-mark spam (max 1).
- Thai language throughout. Natural, human tone — not translated-English.

OUTPUT — return VALID JSON ONLY, exactly this shape:
{
  "selling_hook": "1 line, <= 14 Thai words, curiosity + pain + promise. This is the eyebrow above the title.",
  "product_description": "1 short paragraph, <= 60 Thai words, ends with a soft CTA line.",
  "benefit_bullets": ["4-5 outcome-first bullets, each <= 12 Thai words, no leading dashes or numbers"]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json().catch(() => ({}));
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: e, error } = await db.from("ebooks")
      .select("id, title, subtitle, target_buyer, hook, product_description, category_id, cover_spec, cost_usd")
      .eq("id", ebook_id).single();
    if (error) throw error;
    if (!e) throw new Error("Ebook not found");

    const category = e.category_id
      ? (await db.from("categories").select("name").eq("id", e.category_id).maybeSingle()).data?.name
      : null;

    const spec = (e.cover_spec ?? {}) as Record<string, unknown>;
    const lever = String(spec.emotional_trigger ?? spec.creative_direction ?? "");
    const transformation = String(spec.desired_transformation ?? "");
    const buyerPain = String(spec.buyer_pain ?? e.hook ?? "");

    const ai = await aiJSON<SellingCopy>({
      model: "google/gemini-3.1-pro-preview",
      system: SYSTEM,
      user: `Ebook: ${e.title}
Subtitle: ${e.subtitle ?? ""}
Category: ${category ?? "general"}
Target buyer: ${e.target_buyer ?? spec.target_buyer ?? ""}
Buyer pain: ${buyerPain}
Desired transformation: ${transformation}
Psychological lever / emotional trigger: ${lever}
Existing description (may be weak): ${(e.product_description ?? "").slice(0, 400)}

Write NEW Thai selling copy per the schema. Sharpen the pain, make the promise specific, and end the paragraph with a soft CTA (e.g. "ดาวน์โหลดฟรีตอนนี้").`,
    });

    const bullets = Array.isArray(ai.data.benefit_bullets)
      ? ai.data.benefit_bullets.filter((b) => typeof b === "string" && b.trim()).slice(0, 5)
      : [];
    const payload = {
      selling_hook: (ai.data.selling_hook ?? "").toString().trim().slice(0, 140),
      product_description: (ai.data.product_description ?? "").toString().trim().slice(0, 600),
      benefit_bullets: bullets,
    };

    await db.from("ebooks").update({
      selling_hook: payload.selling_hook || null,
      product_description: payload.product_description || e.product_description,
      benefit_bullets: payload.benefit_bullets as unknown as never,
      cost_usd: Number(e.cost_usd ?? 0) + ai.usage.cost_usd,
      updated_at: new Date().toISOString(),
    }).eq("id", ebook_id);

    await logCost(db, { ebook_id, step: "selling_copy", model: ai.model, ...ai.usage });

    return new Response(JSON.stringify({ ok: true, ...payload }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
