// Regenerate the complete internal-store listing copy for an ebook:
// selling hook, product description (short card), long description, key
// benefits, who it's for, what's included, preview blurb — all in Thai and
// styled per the book's category profile.
import { corsHeaders, admin, aiJSON, logCost, requireAdmin } from "../_shared/ai.ts";
import { resolveStyleProfile } from "../_shared/thumbnail-style-system.ts";

interface ListingCopy {
  selling_hook: string;
  short_hook: string;
  product_description: string;      // short card (≤ 60 words)
  shopping_card_description: string;// 1–2 lines for shopping-list row
  long_description: string;         // full product-page paragraph
  benefit_bullets: string[];        // 4–5, storefront hero list
  key_benefits: string[];           // 4–5, product-page detail list (may repeat)
  who_it_is_for: string;            // 1–2 sentences
  what_you_get: string[];           // 3–6 items
  preview_blurb: string;            // teaser
}

const BASE_SYSTEM = `You are a world-class direct-response copywriter for a Thai digital ebook store.
Write short, punchy, human, HIGH-CONVERTING sales copy in THAI.

RULES:
- Speak to the buyer's real pain and the transformation they want.
- Curiosity, specificity, urgency — never vague fluff.
- NEVER promise guaranteed income, health, medical, legal, or relationship outcomes.
- No emojis. No hashtags. Max 1 exclamation mark across all fields.
- Natural Thai — never translated-English feel.
- Match the category tone the caller specifies.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json().catch(() => ({}));
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: e, error } = await db.from("ebooks")
      .select("id, title, subtitle, target_buyer, hook, product_description, category_id, category_slug, cover_spec, cost_usd")
      .eq("id", ebook_id).single();
    if (error) throw error;
    if (!e) throw new Error("Ebook not found");

    const category = e.category_id
      ? (await db.from("categories").select("name,slug").eq("id", e.category_id).maybeSingle()).data
      : null;

    const profile = resolveStyleProfile({
      category_slug: e.category_slug ?? category?.slug ?? null,
      category_name: category?.name ?? null,
      title: e.title,
      subtitle: e.subtitle,
    });

    const spec = (e.cover_spec ?? {}) as Record<string, unknown>;
    const lever = String(spec.emotional_trigger ?? spec.creative_direction ?? "");
    const transformation = String(spec.desired_transformation ?? "");
    const buyerPain = String(spec.buyer_pain ?? e.hook ?? "");

    const disclaimerLine = profile.disclaimers.length
      ? `\nMandatory disclaimer to append at the end of long_description (Thai): "${profile.disclaimers[0]}"`
      : "";

    const schema = `OUTPUT — return VALID JSON ONLY, exactly this shape:
{
  "selling_hook": "1 line eyebrow, <=14 Thai words, curiosity + pain + promise",
  "short_hook": "1 line hook for shopping-list card, <=12 Thai words",
  "product_description": "1 paragraph <=60 Thai words, ends with soft CTA e.g. ดาวน์โหลดฟรีตอนนี้",
  "shopping_card_description": "1-2 lines <=40 Thai words for compact card",
  "long_description": "2-3 short paragraphs, buyer-focused, ends with CTA + disclaimer if provided",
  "benefit_bullets": ["4-5 outcome-first bullets, each <=12 Thai words"],
  "key_benefits": ["4-5 detailed benefit lines <=16 Thai words each"],
  "who_it_is_for": "1-2 Thai sentences describing the ideal buyer",
  "what_you_get": ["3-6 items — chapters, worksheets, templates, bonuses"],
  "preview_blurb": "1 Thai sentence teasing what's inside, <=20 words"
}`;

    const ai = await aiJSON<ListingCopy>({
      model: "google/gemini-3.1-pro-preview",
      system: BASE_SYSTEM,
      user: `Category profile: ${profile.display_name} (tone: ${profile.tone})
Copy tone guidance: ${profile.copy_tone}${disclaimerLine}

Ebook: ${e.title}
Subtitle: ${e.subtitle ?? ""}
Target buyer: ${e.target_buyer ?? spec.target_buyer ?? ""}
Buyer pain: ${buyerPain}
Desired transformation: ${transformation}
Psychological lever: ${lever}
Existing description (may be weak): ${(e.product_description ?? "").slice(0, 400)}

Write fresh Thai listing copy per the schema below. Sharpen the pain, make the promise specific, respect the tone, and honor all rules (no guarantees, no emojis).

${schema}`,
    });

    const arr = (v: unknown, max: number): string[] =>
      Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()).slice(0, max) : [];
    const str = (v: unknown, max = 600): string =>
      (typeof v === "string" ? v : "").trim().slice(0, max);

    const payload = {
      selling_hook: str(ai.data.selling_hook, 140),
      short_hook: str(ai.data.short_hook ?? ai.data.selling_hook, 120),
      product_description: str(ai.data.product_description, 600),
      shopping_card_description: str(ai.data.shopping_card_description ?? ai.data.product_description, 240),
      long_description: str(ai.data.long_description, 2000),
      benefit_bullets: arr(ai.data.benefit_bullets, 5),
      key_benefits: arr(ai.data.key_benefits, 5),
      who_it_is_for: str(ai.data.who_it_is_for, 300),
      what_you_get: arr(ai.data.what_you_get, 6),
      preview_blurb: str(ai.data.preview_blurb, 200),
    };

    await db.from("ebooks").update({
      selling_hook: payload.selling_hook || null,
      short_hook: payload.short_hook || null,
      product_description: payload.product_description || e.product_description,
      shopping_card_description: payload.shopping_card_description || null,
      long_description: payload.long_description || null,
      benefit_bullets: payload.benefit_bullets as unknown as never,
      key_benefits: payload.key_benefits as unknown as never,
      who_it_is_for: payload.who_it_is_for || null,
      what_you_get: payload.what_you_get as unknown as never,
      preview_blurb: payload.preview_blurb || null,
      category_slug: profile.slug,
      cost_usd: Number(e.cost_usd ?? 0) + ai.usage.cost_usd,
      updated_at: new Date().toISOString(),
    }).eq("id", ebook_id);

    await logCost(db, { ebook_id, step: "selling_copy", model: ai.model, ...ai.usage });

    return new Response(JSON.stringify({ ok: true, category_slug: profile.slug, ...payload }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
