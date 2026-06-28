// Generate ebook cover: AI design strategy → text-free background → code-overlaid text → QC.
import { corsHeaders, admin, aiJSON, logCost, requireAdmin } from "../_shared/ai.ts";
import { buildCoverSVG, rasterizeSVG, type CoverSpec } from "../_shared/cover.ts";

type EbookRow = {
  id: string; title: string; subtitle: string | null;
  target_buyer: string | null; hook: string | null;
  product_description: string | null; cover_prompt: string | null;
  cost_usd: number | null; status: string | null;
  qc: Record<string, unknown> | null;
  cover_spec: CoverSpec | null;
  category_id: string | null;
};

const COVER_DESIGNER_SYSTEM = `You are a world-class premium PDF ebook cover designer, visual sales strategist, and conversion-focused digital product designer.
Create ebook covers that visually SELL the promise of the ebook to USA buyers of premium PDF guides on Shopify.

Hard rules:
- The background image MUST contain ZERO text, letters, numbers, logos, watermarks, signage, or typography. All title/subtitle/brand text is overlaid by code afterward.
- Premium, bold, clear hierarchy, strong contrast, no clutter, no cheap template look, no stock-image vibe.
- Must read as a thumbnail at 200px wide (mobile Shopify grid).
- Match the topic and buyer psychology.

Output schema fields:
- title_text: short, punchy, MAX 50 chars, ALL CAPS friendly. No emoji.
- subtitle_text: 1 sentence, MAX 100 chars, transformation-focused (outcome the buyer gets).
- badge_text: optional, MAX 28 chars, all caps friendly (e.g. "2026 EDITION", "INCLUDES WORKSHEETS", "STEP-BY-STEP PLAYBOOK", "PREMIUM TACTICAL WORKBOOK").
- brand_text: keep as provided.
- layout_direction: "top" | "bottom" | "center".
- typography_style: short description (e.g. "Bold condensed sans serif, tight tracking, editorial").
- color_palette: 3 hex codes [overlay_for_text_panel, primary_text_color, accent_color]. Choose category-appropriate PREMIUM tones:
  * Finance / debt / money / investing / wealth: navy (#0b1a2b), near-black (#0a0f1a), gold (#d4af37), emerald (#0f6b48), ivory white (#f5f1e8). Theme: clarity, control, structure, escape from debt, freedom, confidence.
  * Health / fitness: deep forest, charcoal, lime accent, off-white.
  * Business / marketing: midnight blue, graphite, electric orange or gold.
  * Mindset / self-development: warm charcoal, cream, burnt orange or muted gold.
  * Creative / design: ink black, bone, single saturated accent.
  Avoid purple/indigo gradient AI clichés unless the topic explicitly calls for it.
- background_image_prompt_no_text: ONE paragraph, cinematic, premium editorial, on-topic, vertical 2:3, leaves a clean low-detail area for the text panel. Explicitly state "no text, no words, no letters, no logos, no typography anywhere in the image". For finance topics, lean into visual metaphors of structure, clean architecture, ascending steps/stairs, a clear path, balanced scales, organized lines — NOT cash piles or cartoonish wallets.
- thumbnail_readability_notes: how the title stays readable at 200px wide.
- why_this_cover_sells: 1-2 sentences on the buyer psychology angle.
- cover_qc_checklist: 5-7 specific QC items (readable title, brand visible, no overlap, premium feel, matches topic, no misleading claim, thumbnail-safe).`;

const COVER_QC_SYSTEM = `You are a conversion-focused ebook cover QC reviewer. Score the cover plan for a paid premium PDF on USA Shopify.
Return JSON only:
{
  "title_readable": true|false,
  "subtitle_readable": true|false,
  "brand_visible": true|false,
  "matches_topic": true|false,
  "looks_premium": true|false,
  "works_as_thumbnail": true|false,
  "no_misleading_claim": true|false,
  "no_clutter": true|false,
  "no_overlap": true|false,
  "strong_contrast": true|false,
  "no_ai_text_errors": true|false,
  "mobile_thumbnail_readable": true|false,
  "conversion_score": 0-100,
  "issues": ["..."],
  "improvements": ["..."]
}
Score harshly. >= 85 required to pass.
no_ai_text_errors: the BACKGROUND must contain ZERO letters/words/numbers. If the background prompt or strategy implies text in the image, mark false.
no_overlap: title, subtitle, badge, brand must not visually overlap given the layout_direction and panel placement.
strong_contrast: overlay color vs primary_text color must have strong luminance contrast.`;


async function generateBackgroundPNG(prompt: string): Promise<{ bytes: Uint8Array; cost: number }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const cleanPrompt = `${prompt}\n\nABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO TYPOGRAPHY, NO LOGOS, NO SIGNS, NO NUMBERS in the image. Vertical 2:3 book cover composition, premium editorial photography/illustration quality. Leave a clean, low-detail area at the bottom for text overlay.`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content: cleanPrompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) throw new Error(`Image gen ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const b64: string = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("No background image returned");
  return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), cost: 0.04 };
}

async function processCover(ebook: EbookRow, regenerateSpec: boolean) {
  const db = admin();
  const ebook_id = ebook.id;
  const previousStatus = ebook.status ?? "review";
  let totalCost = 0;
  try {
    // 1) Cover strategy (skip if cached spec & not regenerating)
    let spec: CoverSpec = ebook.cover_spec as CoverSpec;
    if (!spec || regenerateSpec) {
      const category = ebook.category_id
        ? (await db.from("categories").select("name").eq("id", ebook.category_id).maybeSingle()).data?.name
        : null;
      const ai = await aiJSON<CoverSpec>({
        model: "google/gemini-3.1-pro-preview",
        system: COVER_DESIGNER_SYSTEM,
        user: `Ebook Title: ${ebook.title}
Subtitle: ${ebook.subtitle ?? ""}
Category: ${category ?? "general"}
Target Buyer: ${ebook.target_buyer ?? ""}
Core Pain Point: ${ebook.hook ?? ""}
Transformation Promise: ${(ebook.product_description ?? "").slice(0, 400)}
Primary Hook: ${ebook.hook ?? ""}
Brand Name: Secret PDF
Price Tier: Premium
Cover Style Preference: Premium editorial, bold typography overlay, on-topic imagery.

Return JSON with this exact schema:
{
  "cover_strategy": "",
  "visual_sales_angle": "",
  "cover_size": "1600x2400 px",
  "background_image_prompt_no_text": "",
  "title_text": "",
  "subtitle_text": "",
  "badge_text": "",
  "brand_text": "SECRET PDF",
  "layout_direction": "bottom",
  "color_palette": ["#0b1a2b","#ffffff","#f5c518"],
  "typography_style": "",
  "thumbnail_readability_notes": "",
  "why_this_cover_sells": "",
  "cover_qc_checklist": ["",""]
}`,
      });
      totalCost += ai.usage.cost_usd;
      await logCost(db, { ebook_id, step: "cover_spec", model: ai.model, ...ai.usage });
      spec = ai.data;
      // sanity defaults
      spec.brand_text = spec.brand_text || "SECRET PDF";
      spec.title_text = (spec.title_text || ebook.title).slice(0, 60);
      spec.subtitle_text = (spec.subtitle_text || ebook.subtitle || "").slice(0, 120);
      spec.color_palette = (spec.color_palette && spec.color_palette.length >= 3)
        ? spec.color_palette
        : ["#0b1a2b", "#ffffff", "#f5c518"];
      spec.layout_direction = spec.layout_direction || "bottom";
    }

    // 2) Background image (no text)
    const bg = await generateBackgroundPNG(spec.background_image_prompt_no_text || ebook.cover_prompt || `Premium editorial cover image for "${ebook.title}"`);
    totalCost += bg.cost;
    const bgPath = `${ebook_id}/bg.png`;
    {
      const { error } = await db.storage.from("ebook-covers").upload(bgPath, bg.bytes, { contentType: "image/png", upsert: true });
      if (error) throw error;
    }
    const { data: bgSigned } = await db.storage.from("ebook-covers").createSignedUrl(bgPath, 60 * 60 * 24 * 365);

    // 3) Compose SVG → rasterize PNG
    const svg = buildCoverSVG(spec, bg.bytes);
    const coverPng = await rasterizeSVG(svg, 1600);
    const coverPath = `${ebook_id}/cover.png`;
    {
      const { error } = await db.storage.from("ebook-covers").upload(coverPath, coverPng, { contentType: "image/png", upsert: true });
      if (error) throw error;
    }
    const { data: coverSigned } = await db.storage.from("ebook-covers").createSignedUrl(coverPath, 60 * 60 * 24 * 365);

    // 4) Cover QC
    const qc = await aiJSON<{
      title_readable: boolean; subtitle_readable: boolean; brand_visible: boolean;
      matches_topic: boolean; looks_premium: boolean; works_as_thumbnail: boolean;
      no_misleading_claim: boolean; no_clutter: boolean;
      conversion_score: number; issues: string[]; improvements: string[];
    }>({
      model: "google/gemini-3.1-pro-preview",
      system: COVER_QC_SYSTEM,
      user: `Cover spec:\n${JSON.stringify(spec, null, 2)}\nEbook title: ${ebook.title}\nSubtitle: ${ebook.subtitle ?? ""}\nTarget buyer: ${ebook.target_buyer ?? ""}`,
    });
    totalCost += qc.usage.cost_usd;
    await logCost(db, { ebook_id, step: "cover_qc", model: qc.model, ...qc.usage });

    const score = Number(qc.data.conversion_score ?? 0);
    const passed = score >= 85 &&
      qc.data.title_readable && qc.data.subtitle_readable &&
      qc.data.brand_visible && qc.data.matches_topic &&
      qc.data.looks_premium && qc.data.works_as_thumbnail &&
      qc.data.no_misleading_claim && qc.data.no_clutter;

    await db.from("ebooks").update({
      cover_url: coverSigned?.signedUrl,
      cover_bg_url: bgSigned?.signedUrl,
      cover_image_url: coverSigned?.signedUrl,
      cover_spec: spec as unknown as never,
      cover_qc: qc.data as unknown as never,
      cover_score: score,
      cover_approved: false,
      status: previousStatus === "cover" ? "review" : previousStatus,
      qc: { ...(ebook.qc ?? {}), cover_error: null, cover_passed: passed },
      cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
    }).eq("id", ebook_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cover generation failed", message);
    await db.from("ebooks").update({
      status: previousStatus === "cover" ? "review" : previousStatus,
      qc: { ...(ebook.qc ?? {}), cover_error: message },
    }).eq("id", ebook_id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const { ebook_id, regenerate_spec = true } = body as { ebook_id?: string; regenerate_spec?: boolean };
    if (!ebook_id) throw new Error("ebook_id required");
    const { data: e } = await db.from("ebooks")
      .select("id,title,subtitle,target_buyer,hook,product_description,cover_prompt,cost_usd,status,qc,cover_spec,category_id")
      .eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");

    await db.from("ebooks").update({ status: "cover", qc: { ...(e.qc ?? {}), cover_error: null } }).eq("id", ebook_id);
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<void>) => void } })
      .EdgeRuntime?.waitUntil?.(processCover(e as unknown as EbookRow, regenerate_spec));

    return new Response(JSON.stringify({ status: "cover", started: true }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
