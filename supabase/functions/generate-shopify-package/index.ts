// Shopify Product Packaging — implements the Shopify Product Expert skill.
// POST { ebook_id }
// Generates and persists: shopify_title, shopify_subtitle, short_hook, body_html,
// benefit_bullets, whats_inside, who_its_for, who_its_not_for, price,
// compare_at_price, launch_price, price_tier, seo_title, meta_description,
// url_slug, tags, pricing_confidence_score, product_page_qc_score.
// Uses the Lovable AI Gateway. Idempotent — safe to re-run to refresh copy.
import { admin, corsHeaders, aiJSON, pickModel } from "../_shared/ai.ts";

type ShopifyPackage = {
  shopify_title: string;
  shopify_subtitle?: string;
  short_hook: string;
  body_html: string;
  benefit_bullets: string[];
  whats_inside: string[];
  who_its_for: string[];
  who_its_not_for: string[];
  price: number | string;
  compare_at_price?: number | string | null;
  launch_price?: number | string | null;
  price_tier: string;
  pricing_confidence_score: number;
  product_page_qc_score: number;
  seo_title: string;
  meta_description: string;
  url_slug: string;
  tags: string[];
};

const SYSTEM_PROMPT = `You are a world-class Shopify digital-product merchandiser, thumbnail director,
psychological pricer, and conversion copywriter. You follow the Shopify Product Expert master skill.

Never make guarantees, medical claims, income promises, fake reviews, or fake urgency.
Use safe language: "helps you", "designed to", "supports", "may help".
Prices must be psychological (.99 or .95) and match the buyer's income + category band.

Bands:
- Finance / Debt / Cash Flow: $19.99–$49.99 (pro workbook $29.99–$39.99)
- Productivity / Focus:       $17.99–$39.99
- Energy / Health / Wellness: $14.99–$29.99
- Business / AI / Marketing:  $29.99–$99.99
- Relationship / Self-Help:   $14.99–$34.99

Return valid JSON only.`;

const SCHEMA_HINT = `{
  "shopify_title": "string (product-card headline, follows one of the 5 formulas)",
  "shopify_subtitle": "string (short benefit line)",
  "short_hook": "string (1-2 sentences, opens the product page)",
  "body_html": "string (full product description HTML: hook + promise + what's inside + who it's for + who it's not for + why it works + digital delivery + CTA)",
  "benefit_bullets": ["string", "..."],
  "whats_inside": ["string", "..."],
  "who_its_for": ["string", "..."],
  "who_its_not_for": ["string", "..."],
  "price": "number (like 29.99)",
  "compare_at_price": "number|null (optional; only if truthful)",
  "launch_price": "number|null (optional intro price)",
  "price_tier": "entry|standard|premium|professional|advanced",
  "pricing_confidence_score": "0-100 (>=85 required)",
  "product_page_qc_score": "0-100 (>=90 target)",
  "seo_title": "string (<=70 chars)",
  "meta_description": "string (<=160 chars)",
  "url_slug": "string (kebab-case, no filler words)",
  "tags": ["string", "..."]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = admin();
  try {
    const { ebook_id } = await req.json().catch(() => ({}));
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const { data: ebook, error } = await db.from("ebooks").select("*").eq("id", ebook_id).maybeSingle();
    if (error || !ebook) return json({ error: "ebook not found" }, 404);

    const category = ebook.category ?? ebook.topic ?? ebook.niche ?? "general";
    const title = ebook.title ?? "Untitled";
    const subtitle = ebook.subtitle ?? ebook.short_description ?? "";
    const wc = ebook.word_count ?? 0;
    const buyerPain = ebook.buyer_pain ?? ebook.pain_point ?? "";
    const buyerAvatar = ebook.target_buyer ?? ebook.buyer_avatar ?? "";
    const transformation = ebook.transformation ?? ebook.desired_outcome ?? "";

    const userPrompt = `Package this approved ebook as a premium Shopify DRAFT product.

Book title: ${title}
Subtitle: ${subtitle}
Category: ${category}
Target buyer: ${buyerAvatar || "not specified — infer from category"}
Buyer pain: ${buyerPain || "infer from category"}
Desired transformation: ${transformation || "infer from category"}
Word count: ${wc || "unknown"}
Product format: Digital PDF Workbook (instant download, no shipping)

Follow the Shopify Product Expert skill precisely. Recommend a psychological price inside
the category band that matches this buyer's likely income + urgency. Prefer .99 endings.
Write body_html as clean semantic HTML (h2/h3, p, ul, li — no <html>, <body>, <script>).
Keep every claim compliance-safe. No fake reviews, no fake trust badges.`;

    const model = pickModel("marketing", "hybrid");
    const { data: pkg } = await aiJSON<ShopifyPackage>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      model,
      schemaHint: SCHEMA_HINT,
      maxTokens: 4096,
      timeoutMs: 120_000,
    });

    // Normalise + clamp numeric fields.
    const priceNum = Number(pkg.price);
    if (!isFinite(priceNum) || priceNum <= 0) {
      return json({ error: "AI returned invalid price", raw: pkg }, 502);
    }
    const compareAt = pkg.compare_at_price == null ? null : Number(pkg.compare_at_price);
    const launch = pkg.launch_price == null ? null : Number(pkg.launch_price);

    const slug = (pkg.url_slug || slugify(pkg.shopify_title || title)).toLowerCase();

    const patch = {
      shopify_title: pkg.shopify_title,
      shopify_subtitle: pkg.shopify_subtitle ?? null,
      short_hook: pkg.short_hook,
      body_html: pkg.body_html,
      benefit_bullets: pkg.benefit_bullets ?? [],
      whats_inside: pkg.whats_inside ?? [],
      who_its_for: pkg.who_its_for ?? [],
      who_its_not_for: pkg.who_its_not_for ?? [],
      price: priceNum,
      compare_at_price: compareAt && compareAt > priceNum ? compareAt : null,
      launch_price: launch && launch > 0 && launch < priceNum ? launch : null,
      price_tier: pkg.price_tier ?? null,
      seo_title: (pkg.seo_title ?? "").slice(0, 70),
      meta_description: (pkg.meta_description ?? "").slice(0, 160),
      url_slug: slug,
      tags: pkg.tags ?? [],
      pricing_confidence_score: clamp(pkg.pricing_confidence_score, 0, 100),
      product_page_qc_score: clamp(pkg.product_page_qc_score, 0, 100),
      shopify_package_json: pkg,
    };

    const { error: uErr } = await db.from("ebooks").update(patch).eq("id", ebook_id);
    if (uErr) return json({ error: uErr.message }, 500);

    return json({ ok: true, ebook_id, package: patch, model });
  } catch (e) {
    console.error("generate-shopify-package failed:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function slugify(s: string) {
  return s.toString().toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}
function clamp(n: unknown, lo: number, hi: number) {
  const x = Number(n);
  if (!isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
