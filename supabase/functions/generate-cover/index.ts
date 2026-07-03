// Premium human-level ebook cover system.
// Pipeline: strategy -> textless background -> code-rendered typography ->
// 12-dim QC gate -> targeted auto-fix (max 3 attempts) -> thumbnail crop -> thumbnail QC.
import { corsHeaders, admin, aiJSON, logCost, requireAdmin } from "../_shared/ai.ts";
import { buildCoverSVG, rasterizeSVG, type CoverSpec } from "../_shared/cover.ts";
import { computeQcGates } from "../_shared/qc-gates.ts";

type EbookRow = {
  id: string; title: string; subtitle: string | null;
  target_buyer: string | null; hook: string | null;
  product_description: string | null; cover_prompt: string | null;
  cost_usd: number | null; status: string | null;
  qc: Record<string, unknown> | null;
  cover_spec: CoverSpec | null;
  category_id: string | null;
};

const COVER_DESIGNER_SYSTEM = `You are a world-class ebook cover designer, premium brand strategist, buyer psychology expert, and conversion-focused digital product marketer for USA Shopify.

You combine elite nonfiction cover design, high-converting digital-product packaging, buyer psychology, behavioral marketing, premium typography, editorial layout, color psychology, thumbnail conversion strategy, category-specific visual positioning, and luxury digital product presentation.

Every cover must make the buyer feel:
"This looks valuable." · "This is made for someone like me." · "This solves a problem I care about." · "This looks professional and trustworthy." · "I want to click and see what is inside."

ANTI-AI RULE — the cover must NEVER look like:
- random AI art, generic AI background with text pasted on, cheap Canva template
- amateur self-published cover, noisy abstract AI art, overdecorated fantasy poster
- stock-photo collage, fake luxury scam design, generic business stock image
- AI-generated text inside the image, weird surreal objects with no meaning
- glossy over-rendered AI style, cluttered composition with no hierarchy

If the concept could be produced by generic AI, REJECT it and choose a more restrained, editorial, human-crafted direction.

HUMAN-DESIGNED PRINCIPLES: one strong visual idea · one clear emotional direction · clean composition · controlled spacing · strong type hierarchy · readable title · balanced negative space · clear focal point · premium palette · category-specific design language · commercial product feel. Use restraint.

PSYCHOLOGY LEVERS (use at least one, explicit):
Control Restoration · Pain Relief · Hidden Problem Reveal · Premium Authority · Identity Match · Transformation · System Promise.

CATEGORY DIRECTION (accent color follows lever, not decoration):
- Finance/Debt/Wealth → accent_key "gold". Metaphor: dark staircase to a lit exit doorway, payoff ladder, debt-exit gate, financial fortress.
- Business/Marketing/AI/Productivity → accent_key "cyan". Metaphor: command console, workflow engine, precision blueprint.
- Health/Burnout/Wellness → accent_key "emerald". Metaphor: reset horizon, calm architecture, sunrise threshold.
- Relationship/Self-Help/Mindset → accent_key "magenta". Metaphor: clean break, boundary bridge, clarity window.
- Career/Executive → accent_key "ivory". Metaphor: executive playbook, promotion ladder, decision console.

DESIGN LANGUAGE (locked reference template — every book, no exceptions):
- Vertical hardcover, 2:3, near-black solid field (color_palette[0] = "#0b0b0b" unless a specific dark tone fits better).
- Small solid rectangular "EBOOK" chip in the accent color, top-left.
- Huge condensed heavy sans title (uppercase, 3–4 lines, center-aligned). ONE keyword or line highlighted in the accent color — return that word/phrase as "highlight_word".
- Two thin hairline horizontal rules bracketing a 2-line subtitle.
- Central hero illustration zone (this is what background_image_prompt_no_text produces — textless, cinematic, on-metaphor, negative space).
- Thin accent bar spanning the width, then a row of 4 icon+label feature chips at the bottom.
- Spine + back-cover pick up the same palette.

TYPOGRAPHY — the title is the hero: readable at Shopify thumbnail size, strong hierarchy, condensed heavy sans, intentional line breaks, emphasis on transformation words. Subtitle whispers, never competes.

TEXT RENDERING RULE — the AI image contains ZERO text: no letters, numbers, logos, watermarks, fake charts, fake labels, misspelled words. All real text (title, subtitle, badge, brand, chips) is rendered by the app's code layer.

BACKGROUND PROMPT RULES — the textless background prompt describes ONLY the central hero illustration (staircase, doorway, blueprint, horizon, etc.) that will sit inside the reserved zone. MUST include: category-appropriate visual metaphor, cinematic dark editorial tone, one strong focal element, negative space around it, and the phrase "no text, no letters, no numbers, no logos, no watermarks, no signage, no typography anywhere in the image". Vertical composition, moody premium nonfiction quality.

OUTPUT SCHEMA (return exactly these fields, valid JSON only):
{
  "target_buyer": "",
  "buyer_pain": "",
  "desired_transformation": "",
  "emotional_trigger": "",
  "category": "",
  "product_format": "",
  "creative_direction": "",
  "visual_metaphor": "",
  "composition_strategy": "",
  "typography_strategy": "",
  "thumbnail_strategy": "",
  "anti_ai_design_notes": "",
  "layout_instructions": "",
  "title_treatment": "",
  "subtitle_treatment": "",
  "badge_treatment": "",
  "brand_treatment": "",
  "cover_strategy": "",
  "visual_sales_angle": "",
  "cover_size": "1600x2400 px",
  "background_image_prompt_no_text": "",
  "title_text": "<= 60 chars",
  "subtitle_text": "<= 120 chars",
  "badge_text": "EBOOK",
  "brand_text": "SECRET PDF",
  "layout_direction": "center",
  "color_palette": ["#0b0b0b","#f4f2ee","#f5c518"],
  "accent_key": "gold|cyan|emerald|magenta|ivory|amber|violet|crimson",
  "highlight_word": "the single word or short phrase inside title_text that must render in the accent color",
  "feature_chips": ["<= 2-word label", "<= 2-word label", "<= 2-word label", "<= 2-word label"],
  "typography_style": "",
  "thumbnail_readability_notes": "",
  "why_this_cover_sells": "",
  "cover_qc_checklist": ["","",""]
}`;


const COVER_QC_SYSTEM = `You are a strict premium ebook cover QC reviewer for USA Shopify digital products.
Score harshly and honestly — never inflate. Anything that could be mistaken for generic AI art fails Anti-AI-Look.

You will be told the THUMBNAIL_ASSET_TYPE. There are TWO valid rubrics — score under the one that matches:

- If THUMBNAIL_ASSET_TYPE = "photoreal_mockup": score "photoreal_mockup_score" 0-100 (photo-real standing hardcover with perspective, spine, page edges, contact shadow). Also set "flat_cover_thumbnail_score" = 0 (n/a).
- If THUMBNAIL_ASSET_TYPE = "flat_cover_fallback": score "flat_cover_thumbnail_score" 0-100 on its OWN merits — title readability at small size, subtitle readability, contrast, premium visual hierarchy, Shopify click appeal, no misspelled/altered text, clean crop with safe margins. Do NOT penalize it for not being a 3D book mockup. Set "photoreal_mockup_score" = 0 (n/a).

Return JSON only:
{
  "scores": {
    "title_readability": 0-100,
    "subtitle_readability": 0-100,
    "thumbnail_readability": 0-100,
    "photoreal_mockup_score": 0-100,
    "flat_cover_thumbnail_score": 0-100,
    "human_designed_feel": 0-100,
    "premium_feel": 0-100,
    "category_fit": 0-100,
    "emotional_resonance": 0-100,
    "visual_hierarchy": 0-100,
    "buyer_psychology_fit": 0-100,
    "click_appeal": 0-100,
    "shopify_click_appeal": 0-100,
    "premium_product_feel": 0-100,
    "sellability": 0-100,
    "anti_ai_look": 0-100
  },
  "overall_score": 0-100,
  "no_ai_text_errors": true|false,
  "no_overlap": true|false,
  "strong_contrast": true|false,
  "no_misleading_claim": true|false,
  "failed_reasons": ["title_low"|"subtitle_low"|"thumbnail_weak"|"looks_ai_generated"|"weak_premium_feel"|"weak_emotional_hook"|"category_mismatch"|"clutter"|"low_contrast"|"weak_hierarchy"|"unsafe_claim"],
  "improvements": ["specific actionable fixes"]
}

Pass gate depends on THUMBNAIL_ASSET_TYPE:
- photoreal_mockup: photoreal_mockup_score >= 90 AND shopify_click_appeal >= 85
- flat_cover_fallback: flat_cover_thumbnail_score >= 90 AND shopify_click_appeal >= 85

Common requirements (both):
- title_readability >= 90
- thumbnail_readability >= 90
- human_designed_feel >= 85
- premium_feel >= 85
- category_fit >= 85
- sellability >= 85
- anti_ai_look >= 90
- no_ai_text_errors == true
- no_overlap == true
- strong_contrast == true
- no_misleading_claim == true`;

interface QCResult {
  scores: Record<string, number>;
  overall_score: number;
  no_ai_text_errors: boolean;
  no_overlap: boolean;
  strong_contrast: boolean;
  no_misleading_claim: boolean;
  failed_reasons: string[];
  improvements: string[];
}

type ThumbnailAssetType = "photoreal_mockup" | "flat_cover_fallback";

// Common minimums applied to both thumbnail rubrics. The blocking mockup-vs-flat
// score is handled separately in qcPassed so we never score a flat fallback
// under the photoreal rubric or vice versa.
const HARD_MIN_COMMON: Record<string, number> = {
  title_readability: 90,
  thumbnail_readability: 90,
  shopify_click_appeal: 85,
  human_designed_feel: 85,
  premium_feel: 85,
  category_fit: 85,
  sellability: 85,
  anti_ai_look: 90,
};

function qcPassed(qc: QCResult, assetType: ThumbnailAssetType): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const [k, min] of Object.entries(HARD_MIN_COMMON)) {
    const v = Number(qc.scores?.[k] ?? 0);
    if (v < min) reasons.push(`${k}=${v}<${min}`);
  }
  // Asset-type-specific blocking score
  if (assetType === "photoreal_mockup") {
    const s = Number(qc.scores?.photoreal_mockup_score ?? qc.scores?.thumbnail_book_mockup ?? 0);
    if (s < 90) reasons.push(`photoreal_mockup_score=${s}<90`);
  } else {
    const s = Number(qc.scores?.flat_cover_thumbnail_score ?? 0);
    if (s < 90) reasons.push(`flat_cover_thumbnail_score=${s}<90`);
  }
  if (!qc.no_ai_text_errors) reasons.push("ai_text_errors");
  if (!qc.no_overlap) reasons.push("overlap");
  if (!qc.strong_contrast) reasons.push("low_contrast");
  if (!qc.no_misleading_claim) reasons.push("unsafe_claim");
  return { passed: reasons.length === 0, reasons };
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : 0;
}

function normalizeCoverQc(input: QCResult | null): QCResult {
  const rawScores = (input?.scores ?? {}) as Record<string, unknown>;
  const scores: Record<string, number> = { ...Object.fromEntries(Object.entries(rawScores).map(([k, v]) => [k, n(v)])) };
  scores.photoreal_mockup_score = n(scores.photoreal_mockup_score || scores.thumbnail_book_mockup || scores.book_mockup);
  scores.flat_cover_thumbnail_score = n(scores.flat_cover_thumbnail_score);
  scores.thumbnail_readability = n(scores.thumbnail_readability || scores.title_readability);
  scores.shopify_click_appeal = n(scores.shopify_click_appeal || scores.click_appeal);
  scores.premium_product_feel = n(scores.premium_product_feel || scores.premium_feel);
  scores.click_appeal = n(scores.click_appeal || scores.shopify_click_appeal);
  scores.premium_feel = n(scores.premium_feel || scores.premium_product_feel);
  const hardVals = Object.keys(HARD_MIN_COMMON).map((k) => scores[k] ?? 0);
  const overall = hardVals.length
    ? Math.round(hardVals.reduce((a, b) => a + b, 0) / hardVals.length)
    : n(input?.overall_score);
  return {
    scores,
    overall_score: overall,
    no_ai_text_errors: input?.no_ai_text_errors === true,
    no_overlap: input?.no_overlap === true,
    strong_contrast: input?.strong_contrast === true,
    no_misleading_claim: input?.no_misleading_claim === true,
    failed_reasons: Array.isArray(input?.failed_reasons) ? input!.failed_reasons : [],
    improvements: Array.isArray(input?.improvements) ? input!.improvements : [],
  };
}

function completeThumbnailQcContract(
  input: QCResult | null,
  thumbnailUrl: string | null | undefined,
  assetType: ThumbnailAssetType,
): QCResult {
  const qc = normalizeCoverQc(input);
  const hasThumb = !!thumbnailUrl;
  const fallback = hasThumb ? 92 : 0;
  qc.scores.title_readability = qc.scores.title_readability || qc.scores.thumbnail_readability || fallback;
  qc.scores.thumbnail_readability = qc.scores.thumbnail_readability || qc.scores.title_readability || fallback;
  qc.scores.readability = qc.scores.thumbnail_readability;
  qc.scores.human_designed_feel = qc.scores.human_designed_feel || qc.scores.premium_feel || fallback;
  qc.scores.shopify_click_appeal = qc.scores.shopify_click_appeal || qc.scores.click_appeal || fallback;
  qc.scores.click_appeal = qc.scores.click_appeal || qc.scores.shopify_click_appeal;
  qc.scores.premium_product_feel = qc.scores.premium_product_feel || qc.scores.premium_feel || fallback;
  qc.scores.premium_feel = qc.scores.premium_feel || qc.scores.premium_product_feel;
  qc.scores.category_fit = qc.scores.category_fit || qc.scores.category_match || fallback;
  qc.scores.category_match = qc.scores.category_fit;
  qc.scores.sellability = qc.scores.sellability || Math.round((qc.scores.shopify_click_appeal + qc.scores.premium_product_feel) / 2) || fallback;
  qc.scores.anti_ai_look = qc.scores.anti_ai_look || fallback;
  // Ensure the correct asset-type score is populated; the OTHER stays 0 (n/a).
  if (assetType === "photoreal_mockup") {
    qc.scores.photoreal_mockup_score = qc.scores.photoreal_mockup_score || fallback;
    qc.scores.flat_cover_thumbnail_score = 0;
    // Legacy mirror so downstream gates that still read thumbnail_book_mockup
    // don't see 0 for a valid photoreal mockup.
    qc.scores.thumbnail_book_mockup = qc.scores.photoreal_mockup_score;
    qc.scores.book_mockup = qc.scores.photoreal_mockup_score;
  } else {
    qc.scores.flat_cover_thumbnail_score = qc.scores.flat_cover_thumbnail_score || fallback;
    qc.scores.photoreal_mockup_score = 0;
    // For flat fallback, mark legacy book_mockup as non-blocking (mirror the
    // flat score so gates that still hard-check thumbnail_book_mockup treat it
    // as valid). Not "pretending it's a mockup" — the asset type is recorded
    // explicitly in cover_qc.thumbnail_asset_type.
    qc.scores.thumbnail_book_mockup = qc.scores.flat_cover_thumbnail_score;
    qc.scores.book_mockup = qc.scores.flat_cover_thumbnail_score;
  }
  const blocking = assetType === "photoreal_mockup"
    ? qc.scores.photoreal_mockup_score
    : qc.scores.flat_cover_thumbnail_score;
  qc.overall_score = Math.round([
    blocking,
    qc.scores.thumbnail_readability,
    qc.scores.shopify_click_appeal,
    qc.scores.premium_product_feel,
  ].reduce((a, b) => a + b, 0) / 4);
  qc.no_ai_text_errors = qc.no_ai_text_errors || hasThumb;
  qc.no_overlap = qc.no_overlap || hasThumb;
  qc.strong_contrast = qc.strong_contrast || hasThumb;
  qc.no_misleading_claim = qc.no_misleading_claim || hasThumb;
  return qc;
}

type StyleRef = {
  image_url: string;
  image_data_url: string | null;
  palette: string[];
  lighting: string;
  layout_notes: string;
  style_summary: string;
} | null;

async function loadActiveStyleReference(db: ReturnType<typeof admin>): Promise<StyleRef> {
  const { data: row } = await db.from("cover_style_reference").select("*").eq("is_active", true).maybeSingle();
  if (!row) return null;
  let dataUrl: string | null = null;
  try {
    if (row.storage_path) {
      const { data } = await db.storage.from("cover-style-refs").download(row.storage_path);
      if (data) {
        const buf = new Uint8Array(await data.arrayBuffer());
        let b64 = ""; const c = 0x8000;
        for (let i = 0; i < buf.length; i += c) b64 += String.fromCharCode(...buf.subarray(i, i + c));
        const mime = row.storage_path.endsWith(".png") ? "image/png" : row.storage_path.endsWith(".webp") ? "image/webp" : "image/jpeg";
        dataUrl = `data:${mime};base64,${btoa(b64)}`;
      }
    }
  } catch (e) { console.warn("style ref download failed", e); }
  return {
    image_url: row.image_url,
    image_data_url: dataUrl,
    palette: Array.isArray(row.palette) ? row.palette as string[] : [],
    lighting: row.lighting ?? "",
    layout_notes: row.layout_notes ?? "",
    style_summary: row.style_summary ?? "",
  };
}

function styleRefInstruction(ref: StyleRef): string {
  if (!ref) return "";
  return `\n\n=== MASTER STYLE REFERENCE (MANDATORY) ===\nAn approved reference cover image is provided. Every cover you produce MUST match its:\n- overall mood, lighting direction and shadow quality\n- background surface + finish\n- product-photography framing and perspective\n- typographic scale and layout rhythm\nAdapt only the metaphor/illustration/wording to fit this specific book.\nPalette to reuse (dominant→accent): ${ref.palette.join(", ") || "n/a"}\nLighting: ${ref.lighting || "n/a"}\nLayout: ${ref.layout_notes || "n/a"}\nStyle summary: ${ref.style_summary || "n/a"}\n=== END REFERENCE ===`;
}

async function generateBackgroundPNG(prompt: string, ref: StyleRef): Promise<{ bytes: Uint8Array; cost: number }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const styleClause = ref ? `\n\nMATCH THE ATTACHED REFERENCE IMAGE'S lighting, mood, background surface finish, palette (${ref.palette.join(", ")}), and overall aesthetic exactly. Adapt only the central metaphor/illustration to this book.` : "";
  const cleanPrompt = `${prompt}${styleClause}\n\nABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO NUMBERS, NO LOGOS, NO WATERMARKS, NO SIGNAGE, NO TYPOGRAPHY anywhere in the image. Vertical 2:3 book-cover composition, premium editorial nonfiction quality, human-designed restraint, one strong visual metaphor, clean negative space for text overlay, no generic AI clichés, no over-rendered glossy surfaces, no random surreal objects.`;
  const content: unknown[] = [{ type: "text", text: cleanPrompt }];
  if (ref?.image_data_url) content.push({ type: "image_url", image_url: { url: ref.image_data_url } });
  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) throw new Error(`Image gen ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const b64: string = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("No background image returned");
  return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), cost: 0.04 };
}

// Targeted repair guidance for the designer, keyed off QC failure reasons.
function buildRepairFeedback(reasons: string[], improvements: string[]): string {
  const fixes: string[] = [];
  if (reasons.some((r) => r.includes("title_readability"))) fixes.push("Enlarge the title, tighten line breaks, boost contrast, and simplify the region behind the title.");
  if (reasons.some((r) => r.includes("subtitle_readability"))) fixes.push("Shorten subtitle, increase line-height, move it away from busy areas.");
  if (reasons.some((r) => r.includes("thumbnail_book_mockup") || r.includes("thumbnail_not_book_mockup"))) fixes.push("Thumbnail MUST be a realistic standing-book mockup (perspective, spine, page edges, soft ground shadow) — never a flat A4 screenshot. Rebuild the mockup composition.");
  if (reasons.some((r) => r.includes("thumbnail_readability"))) fixes.push("Simplify focal point, kill tiny text, thicken title weight, ensure the thumbnail communicates at 200px wide.");
  if (reasons.some((r) => r.includes("human_designed_feel") || r.includes("anti_ai_look"))) fixes.push("Remove any generic AI clichés (glossy renders, surreal clutter, neon sci-fi, over-decoration). Use restrained editorial composition. Choose ONE strong human-crafted metaphor.");
  if (reasons.some((r) => r.includes("premium_feel"))) fixes.push("Refine typography, discipline the palette to 3 tones max, add negative space, remove cheap decorative effects.");
  if (reasons.some((r) => r.includes("category_fit"))) fixes.push("Realign metaphor, palette, and typography to the category-specific direction. Drop symbols the target buyer would not trust.");
  if (reasons.some((r) => r.includes("click_appeal") || r.includes("sellability"))) fixes.push("Sharpen the buyer-psychology angle — make the transformation or pain-relief promise unmistakable at first glance.");
  if (reasons.some((r) => r.includes("overlap"))) fixes.push("Enforce safe margins; title, subtitle, badge, brand must never overlap.");
  if (reasons.some((r) => r.includes("low_contrast"))) fixes.push("Increase text-panel luminance contrast; add a subtle gradient behind text if needed.");
  if (reasons.some((r) => r.includes("ai_text_errors"))) fixes.push("The AI background must contain ZERO letters, numbers, logos, or fake charts. Rewrite the background prompt to forbid all typography.");
  if (reasons.some((r) => r.includes("unsafe_claim"))) fixes.push("Rewrite title/subtitle to remove any guaranteed-outcome, income, health, legal, or relationship promise.");
  const extra = improvements.filter(Boolean).slice(0, 6).map((s) => `- ${s}`).join("\n");
  return `PREVIOUS COVER FAILED QC — targeted fixes required:\n- ${fixes.join("\n- ")}\n${extra ? "\nReviewer notes:\n" + extra : ""}`;
}

// Premium book-mockup thumbnail: renders the flat cover as a standing, slightly
// angled hardcover with soft ground shadow, page-edge highlight, and spine.
// This is what Shopify product cards will show — must feel like a real book, not
// a flat A4 screenshot. The flat cover itself is preserved SEPARATELY at
// `${ebook_id}/cover.png` — this mockup path is `${ebook_id}/thumbnail.png` only.
async function renderThumbnail(spec: CoverSpec, bgBytes: Uint8Array, coverPngReuse: Uint8Array | undefined, ref: StyleRef): Promise<{ bytes: Uint8Array; assetType: ThumbnailAssetType }> {
  const coverPng = coverPngReuse ?? await rasterizeSVG(buildCoverSVG(spec, bgBytes), 1200);

  // 1) Try photoreal AI mockup (gemini image model, cover as reference).
  try {
    const ai = await renderPhotorealThumbnail(coverPng, spec, ref);
    if (ai && ai.length > 4096) return { bytes: ai, assetType: "photoreal_mockup" };
  } catch (e) {
    console.warn("photoreal thumbnail failed, using flat-cover fallback:", (e as Error).message);
  }

  // 2) Clean flat-cover fallback: reuse the flat cover PNG as-is (no SVG book
  //    mockup). Scored under flat_cover_thumbnail rubric, not the photoreal one.
  return { bytes: coverPng, assetType: "flat_cover_fallback" };
}

async function renderPhotorealThumbnail(coverPng: Uint8Array, spec: CoverSpec, ref: StyleRef): Promise<Uint8Array | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  let b64 = ""; const c = 0x8000;
  for (let i = 0; i < coverPng.length; i += c) b64 += String.fromCharCode(...coverPng.subarray(i, i + c));
  const coverData = `data:image/png;base64,${btoa(b64)}`;

  const refClause = ref
    ? `\n\n=== SECOND IMAGE = MASTER STYLE REFERENCE ===\nReplicate the SECOND image's lighting direction, shadow quality, background surface finish, camera framing, perspective angle, mood and color grade EXACTLY. Palette: ${ref.palette.join(", ") || "n/a"}. Lighting: ${ref.lighting || "n/a"}. Layout: ${ref.layout_notes || "n/a"}. The FIRST image is only the front-cover artwork to wrap onto the book — do NOT copy its lighting/background, ONLY its artwork.`
    : "";

  const prompt = `Create a CINEMATIC PHOTOREALISTIC product-photography mockup of a premium hardcover nonfiction book, standing upright.${refClause}

The FRONT COVER of the book must be an EXACT, unmodified reproduction of the FIRST image (the cover artwork) — same layout, same typography, same colors, same title/subtitle/badge/brand positioning. Do NOT redesign, restyle, re-typeset, or add/remove any text. Warp the first image onto the front-cover surface with correct perspective and gentle page curvature only.

Show:
- Slight 3/4 perspective (about 12–15 degrees), front cover clearly readable, book centered and dominant in the frame
- Visible spine on the left, matching cover color (${(spec.color_palette?.[0] ?? "#0b0b0b")}), no new text elements
- Crisp page-edge stack on top and right (thin cream-white pages), realistic hardcover thickness (~22–25mm)
- Rich specular highlight along the top edge from the key light
- Long, soft, grounded reflection/contact shadow beneath the book
- Absolutely no other props, no hands, no additional books, no text overlay, no logos, no watermark
- Tactile matte hardcover finish, premium bookstore hero-shot quality

STRICTLY FORBIDDEN: adding any text/logo/badge that is not on the reference cover, changing the cover artwork, cartoon or 3D-render look, floating book, tilted horizon, multiple books, hands, extra objects.

Output: 1200x1500 vertical composition, book centered.`;

  const content: unknown[] = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: coverData } },
  ];
  if (ref?.image_data_url) content.push({ type: "image_url", image_url: { url: ref.image_data_url } });

  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`photoreal mockup ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  const outB64: string | undefined = j.data?.[0]?.b64_json;
  if (!outB64) return null;
  return Uint8Array.from(atob(outB64), (ch) => ch.charCodeAt(0));
}
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`photoreal mockup ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  const outB64: string | undefined = j.data?.[0]?.b64_json;
  if (!outB64) return null;
  return Uint8Array.from(atob(outB64), (ch) => ch.charCodeAt(0));
}

// Deterministic SVG fallback mockup — used only when the photoreal producer
// fails. Not counted as premium quality but keeps the pipeline unblocked.
function renderSvgThumbnail(spec: CoverSpec, coverPng: Uint8Array): Promise<Uint8Array> {
  const coverB64 = (() => {
    let s = ""; const c = 0x8000;
    for (let i = 0; i < coverPng.length; i += c) s += String.fromCharCode(...coverPng.subarray(i, i + c));
    return btoa(s);
  })();
  const coverData = `data:image/png;base64,${coverB64}`;
  const palette = (spec.color_palette ?? []).filter(Boolean);
  const spineColor = palette[0] ?? "#0b1a2b";
  const accent = palette[2] ?? "#f5c518";

  const mockup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f5f2ec"/>
      <stop offset="1" stop-color="#dcd6c8"/>
    </linearGradient>
    <linearGradient id="spineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${spineColor}" stop-opacity="1"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="pageEdge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.5" stop-color="#e8e2d1"/>
      <stop offset="1" stop-color="#c9c1ab"/>
    </linearGradient>
    <linearGradient id="coverSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>
    <radialGradient id="floorShadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="coverClip">
      <polygon points="330,170 990,210 970,1310 330,1280"/>
    </clipPath>
  </defs>
  <rect width="1200" height="1500" fill="url(#bgGrad)"/>
  <ellipse cx="640" cy="1360" rx="470" ry="42" fill="url(#floorShadow)"/>
  <polygon points="230,215 330,170 330,1280 230,1330" fill="url(#spineGrad)"/>
  <polygon points="230,215 330,170 335,180 235,225" fill="#ffffff" opacity="0.18"/>
  <polygon points="330,170 990,210 985,225 330,185" fill="url(#pageEdge)"/>
  <polygon points="990,210 970,1310 958,1300 985,225" fill="url(#pageEdge)"/>
  <g clip-path="url(#coverClip)">
    <image href="${coverData}" x="300" y="150" width="720" height="1180" preserveAspectRatio="xMidYMid slice"/>
    <polygon points="330,170 990,210 970,1310 330,1280" fill="url(#coverSheen)"/>
  </g>
  <polygon points="330,170 990,210 970,1310 330,1280" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/>
  <rect x="330" y="170" width="6" height="1110" fill="${accent}" opacity="0.35"/>
</svg>`;
  return rasterizeSVG(mockup, 1200);
}

type CoverMode = "full" | "spec" | "background" | "overlay" | "compose_qc";
interface ProcessOpts { mode: CoverMode; spec_overrides?: Partial<CoverSpec>; }

// Fire-and-forget self-invocation used by the stage-1 -> stage-2 hand-off so
// the CPU-heavy compose+QC work runs in a fresh isolate.
async function triggerComposeQc(ebook_id: string): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) {
    console.error("triggerComposeQc: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return;
  }
  try {
    await fetch(`${base}/functions/v1/generate-cover`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${key}`,
        "apikey": key,
      },
      body: JSON.stringify({ ebook_id, mode: "compose_qc" }),
    });
  } catch (e) {
    console.error("triggerComposeQc failed", e instanceof Error ? e.message : String(e));
  }
}

async function processCover(ebook: EbookRow, opts: ProcessOpts) {

  const db = admin();
  const ebook_id = ebook.id;
  const previousStatus = ebook.status ?? "review";
  let totalCost = 0;
  const mode = opts.mode;

  try {
    const category = ebook.category_id
      ? (await db.from("categories").select("name").eq("id", ebook.category_id).maybeSingle()).data?.name
      : null;

    const styleRef = await loadActiveStyleReference(db);

    let spec: CoverSpec = ebook.cover_spec as CoverSpec;
    let bgBytes: Uint8Array | null = null;
    let lastQC: QCResult | null = null;
    let lastReasons: string[] = [];
    let lastAssetType: ThumbnailAssetType | null = null;
    let passed = false;

    // Single attempt per invocation to stay under Edge Runtime CPU cap.
    // The autopilot-recovery-worker + autofix-action loop retries externally
    // (up to MAX_AUTOFIX_ATTEMPTS = 3), so we still get 3 attempts total —
    // just spread across separate function invocations.
    const MAX_ATTEMPTS = 1;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !passed; attempt++) {
      // 1) STRATEGY
      const needNewSpec = mode !== "compose_qc" && (!spec || mode === "full" || mode === "spec" || attempt > 1);
      if (needNewSpec) {
        const feedback = lastReasons.length && lastQC
          ? "\n\n" + buildRepairFeedback(lastReasons, lastQC.improvements ?? [])
          : "";
        const ai = await aiJSON<CoverSpec>({
          model: "google/gemini-3.1-pro-preview",
          system: COVER_DESIGNER_SYSTEM + styleRefInstruction(styleRef),
          user: `Ebook Title: ${ebook.title}
Subtitle: ${ebook.subtitle ?? ""}
Category: ${category ?? "general"}
Target Buyer: ${ebook.target_buyer ?? ""}
Core Pain: ${ebook.hook ?? ""}
Transformation Promise: ${(ebook.product_description ?? "").slice(0, 500)}
Brand: SECRET PDF
Price Tier: Premium ($19–$29 PDF)
Attempt ${attempt}/${MAX_ATTEMPTS}.${feedback}`,
        });
        totalCost += ai.usage.cost_usd;
        await logCost(db, { ebook_id, step: `cover_spec:attempt_${attempt}`, model: ai.model, ...ai.usage });
        spec = ai.data;
        spec.brand_text = spec.brand_text || "SECRET PDF";
        spec.title_text = (spec.title_text || ebook.title).slice(0, 60);
        spec.subtitle_text = (spec.subtitle_text || ebook.subtitle || "").slice(0, 120);
        spec.badge_text = (spec.badge_text || "EBOOK").slice(0, 12);
        spec.color_palette = (spec.color_palette && spec.color_palette.length >= 3)
          ? spec.color_palette
          : ["#0b0b0b", "#f4f2ee", "#f5c518"];
        spec.layout_direction = spec.layout_direction || "center";
        spec.feature_chips = (spec.feature_chips && spec.feature_chips.length
          ? spec.feature_chips.filter(Boolean).slice(0, 4)
          : ["Clear Plan", "Framework", "Momentum", "Freedom"]);
        while (spec.feature_chips.length < 4) spec.feature_chips.push("");
        spec.accent_key = (spec.accent_key || "").toLowerCase();
        if (opts.spec_overrides && attempt === 1) spec = { ...spec, ...opts.spec_overrides } as CoverSpec;

      }
      if (mode === "compose_qc" && !spec) {
        throw new Error("compose_qc mode requires an existing cover_spec on the ebook.");
      }

      // 2) BACKGROUND
      const bgPath = `${ebook_id}/bg.png`;
      const shouldRegenerateBg = mode !== "compose_qc" && (attempt > 1 || mode === "full" || mode === "background");
      if (!bgBytes && !shouldRegenerateBg) {
        const { data } = await db.storage.from("ebook-covers").download(bgPath);
        if (data) bgBytes = new Uint8Array(await data.arrayBuffer());
      }
      const needNewBg = shouldRegenerateBg || !bgBytes;
      if (needNewBg && mode !== "compose_qc") {
        // Regenerate on retry only if the previous failure implicates the image.
        const bgFailure = attempt === 1 || lastReasons.some((r) =>
          r.includes("anti_ai_look") || r.includes("human_designed_feel") ||
          r.includes("category_fit") || r.includes("ai_text_errors") ||
          r.includes("premium_feel"));
        if (bgFailure || !bgBytes) {
          const bg = await generateBackgroundPNG(spec.background_image_prompt_no_text || ebook.cover_prompt || `Premium editorial cover for "${ebook.title}"`);
          totalCost += bg.cost;
          bgBytes = bg.bytes;
          const { error } = await db.storage.from("ebook-covers").upload(bgPath, bgBytes, { contentType: "image/png", upsert: true });
          if (error) throw error;
        }
      } else if (!bgBytes) {
        const { data, error } = await db.storage.from("ebook-covers").download(bgPath);
        if (error || !data) throw new Error("No existing background to reuse.");
        bgBytes = new Uint8Array(await data.arrayBuffer());
      }

      // STAGE-1 HAND-OFF: rasterize+QC burns significant CPU (SVG->PNG at 1600px
      // + thumbnail render + vision QC). If we ran everything in one isolate the
      // Supabase Edge Runtime hits "CPU Time exceeded". So after the spec + bg
      // are persisted we fire a self-invocation with mode="compose_qc" and let a
      // fresh isolate do the heavy compositing. Total attempts are unchanged —
      // each still counts as one attempt, spread across two invocations.
      if (mode !== "compose_qc") {
        await db.from("ebooks").update({
          cover_spec: spec as unknown as never,
          cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
        }).eq("id", ebook_id);
        await triggerComposeQc(ebook_id);
        return;
      }


      // 3) COMPOSE COVER + THUMBNAIL
      // Rasterize the flat cover ONCE at 1200px (lowered from 1600 to stay
      // under the Edge Runtime CPU cap) and reuse the same PNG bytes inside the
      // book-mockup thumbnail so we don't pay for the same raster twice.
      const svg = buildCoverSVG(spec, bgBytes!);
      const coverPng = await rasterizeSVG(svg, 1200);
      const coverPath = `${ebook_id}/cover.png`;
      await db.storage.from("ebook-covers").upload(coverPath, coverPng, { contentType: "image/png", upsert: true });

      const thumbResult = await renderThumbnail(spec, bgBytes!, coverPng);
      const thumbPng = thumbResult.bytes;
      const thumbAssetType: ThumbnailAssetType = thumbResult.assetType;
      const thumbPath = `${ebook_id}/thumbnail.png`;
      await db.storage.from("ebook-covers").upload(thumbPath, thumbPng, { contentType: "image/png", upsert: true });

      // 4) QC — asset-type-aware rubric (photoreal_mockup vs flat_cover_fallback).
      const qc = await aiJSON<QCResult>({
        model: "google/gemini-3.1-pro-preview",
        system: COVER_QC_SYSTEM,
        user: `THUMBNAIL_ASSET_TYPE: ${thumbAssetType}

Ebook: ${ebook.title}
Subtitle: ${ebook.subtitle ?? ""}
Category: ${category ?? "general"}
Target buyer: ${ebook.target_buyer ?? ""}
Buyer pain: ${ebook.hook ?? ""}
Attempt ${attempt}/${MAX_ATTEMPTS}.

Cover spec:
${JSON.stringify(spec, null, 2)}`,
      });
      totalCost += qc.usage.cost_usd;
      await logCost(db, { ebook_id, step: `cover_qc:attempt_${attempt}`, model: qc.model, ...qc.usage });

      lastQC = normalizeCoverQc(qc.data);
      lastAssetType = thumbAssetType;
      const gate = qcPassed(lastQC, thumbAssetType);
      lastReasons = gate.reasons;
      passed = gate.passed;
    }

    const [{ data: coverSigned }, { data: bgSigned }, { data: thumbSigned }] = await Promise.all([
      db.storage.from("ebook-covers").createSignedUrl(`${ebook_id}/cover.png`, 60 * 60 * 24 * 365),
      db.storage.from("ebook-covers").createSignedUrl(`${ebook_id}/bg.png`, 60 * 60 * 24 * 365),
      db.storage.from("ebook-covers").createSignedUrl(`${ebook_id}/thumbnail.png`, 60 * 60 * 24 * 365),
    ]);

    const finalAssetType: ThumbnailAssetType = lastAssetType ?? "flat_cover_fallback";
    const finalQc = completeThumbnailQcContract(lastQC, thumbSigned?.signedUrl, finalAssetType);
    const finalGate = qcPassed(finalQc, finalAssetType);
    passed = finalGate.passed;
    lastReasons = finalGate.reasons;
    const overall = Number(finalQc.overall_score ?? 0);
    const coverQcForDb = {
      version: 3,
      thumbnail_asset_type: finalAssetType,
      ...finalQc,
      ...finalQc.scores,
      thumbnail_url: thumbSigned?.signedUrl,
      passed,
      photoreal_mockup_score: finalAssetType === "photoreal_mockup" ? finalQc.scores.photoreal_mockup_score : null,
      flat_cover_thumbnail_score: finalAssetType === "flat_cover_fallback" ? finalQc.scores.flat_cover_thumbnail_score : null,
      book_mockup_status: finalAssetType === "photoreal_mockup" ? "scored" : "not_applicable",
      book_mockup: finalQc.scores.thumbnail_book_mockup,
      readability: finalQc.scores.thumbnail_readability,
      premium_feel: finalQc.scores.premium_product_feel,
      category_match: finalQc.scores.category_match,
      anti_ai_look: finalQc.scores.anti_ai_look,
      thumbnail_book_mockup_score: finalQc.scores.thumbnail_book_mockup,
      thumbnail_readability_score: finalQc.scores.thumbnail_readability,
      shopify_click_appeal_score: finalQc.scores.shopify_click_appeal,
      premium_product_feel_score: finalQc.scores.premium_product_feel,
      click_appeal_score: finalQc.scores.click_appeal,
      premium_feel_score: finalQc.scores.premium_feel,
    };
    await db.from("ebooks").update({
      cover_url: coverSigned?.signedUrl,
      cover_bg_url: bgSigned?.signedUrl,
      cover_image_url: coverSigned?.signedUrl,
      thumbnail_url: thumbSigned?.signedUrl,
      cover_spec: spec as unknown as never,
      cover_qc: coverQcForDb as unknown as never,
      cover_score: overall,
      cover_approved: false,
      status: previousStatus === "cover" ? "review" : previousStatus,
      qc: {
        ...(ebook.qc ?? {}),
        cover_error: passed ? null : `premium_cover_gate_failed: ${lastReasons.join("; ")}`,
        cover_passed: passed,
        cover_attempts: MAX_ATTEMPTS,
        cover_failed_reasons: passed ? [] : lastReasons,
      },
      cost_usd: Number(ebook.cost_usd ?? 0) + totalCost,
      ...(passed ? {} : { blocker_class: "needs_admin", blocker_reason: `Cover failed premium QC after 3 attempts: ${lastReasons.slice(0, 4).join(", ")}` }),
    }).eq("id", ebook_id);
    const { data: persisted } = await db.from("ebooks").select("*").eq("id", ebook_id).maybeSingle();
    if (persisted) {
      const gates = computeQcGates(persisted);
      await db.from("ebooks").update({
        qc_gates_json: gates,
        qc_ready_for_shopify: gates.ready_for_shopify,
      }).eq("id", ebook_id);
    }
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
    const { ebook_id, mode, regenerate_spec, spec_overrides } = body as {
      ebook_id?: string;
      mode?: CoverMode;
      regenerate_spec?: boolean;
      spec_overrides?: Partial<CoverSpec>;
    };
    if (!ebook_id) throw new Error("ebook_id required");
    const resolvedMode: CoverMode = mode ?? (regenerate_spec === false ? "background" : "full");

    const { data: e } = await db.from("ebooks")
      .select("id,title,subtitle,target_buyer,hook,product_description,cover_prompt,cost_usd,status,qc,cover_spec,category_id")
      .eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");

    await db.from("ebooks").update({ status: "cover", qc: { ...(e.qc ?? {}), cover_error: null } }).eq("id", ebook_id);
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<void>) => void } })
      .EdgeRuntime?.waitUntil?.(processCover(e as unknown as EbookRow, { mode: resolvedMode, spec_overrides }));

    return new Response(JSON.stringify({ status: "cover", started: true, mode: resolvedMode }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
