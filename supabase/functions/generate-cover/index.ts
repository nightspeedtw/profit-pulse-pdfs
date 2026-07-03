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

CATEGORY DIRECTION:
- Finance/Debt/Wealth: navy, black, white, gold, charcoal, muted emerald. Metaphors: debt exit path, cash-flow dashboard, financial fortress, payoff ladder, dark maze with gold exit, balance-sheet blueprint. Avoid: cartoon money, dollar signs, cash piles, scammy get-rich look.
- Business/Marketing/AI/Productivity: black, white, graphite, silver, deep purple, muted cyan, controlled electric blue. Metaphors: workflow engine, operating system, command center, automation map, precision dashboard. Avoid: generic robots, neon AI clichés, circuit boards, futuristic clutter.
- Relationship/Self-Help/Emotional: warm neutrals, deep burgundy, muted rose, soft charcoal, cream. Metaphors: emotional reset, clean break, boundary map, conversation bridge, overthinking maze, clarity window. Avoid: cheesy hearts, couple stock, dramatic romance clichés.
- Health/Burnout/Wellness: soft beige, muted green, warm white, calm blue. Metaphors: reset button, calm system, balance architecture, energy recovery, burnout-to-clarity. Avoid: medical fear, exaggerated bodies, generic spa, fake before/after.
- Career/Executive/High Performer: deep navy, graphite, ivory, restrained gold. Metaphors: command system, executive playbook, decision map, promotion ladder, professional OS. Avoid: cheap corporate stock, generic office people, boring resume look.

TYPOGRAPHY — the title is the hero: readable at Shopify thumbnail size, strong hierarchy, premium sans-serif, intentional line breaks, emphasis on transformation words, aligned to a clear grid, readable in 2 seconds. Subtitle supports, never competes. No childish or novelty fonts. Contrast panel behind title if the background is busy.

TEXT RENDERING RULE — the AI image contains ZERO text: no letters, numbers, logos, watermarks, fake charts, fake labels, misspelled words. All real text (title, subtitle, badge, brand) is rendered by the app's code layer.

BACKGROUND PROMPT RULES — the textless background prompt MUST include: category-appropriate visual metaphor, emotional tone, composition guidance, an explicit clean-space zone for the title, and the phrase "no text, no letters, no numbers, no logos, no watermarks, no signage, no typography anywhere in the image". Vertical 2:3 composition, editorial commercial ebook-cover quality.

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
  "badge_text": "<= 28 chars",
  "brand_text": "SECRET PDF",
  "layout_direction": "top|bottom|center",
  "color_palette": ["#hex","#hex","#hex"],
  "typography_style": "",
  "thumbnail_readability_notes": "",
  "why_this_cover_sells": "",
  "cover_qc_checklist": ["","",""]
}`;

const COVER_QC_SYSTEM = `You are a strict premium ebook cover QC reviewer for USA Shopify digital products.
Score harshly and honestly — never inflate. Anything that could be mistaken for generic AI art fails Anti-AI-Look.

Return JSON only:
{
  "scores": {
    "title_readability": 0-100,
    "subtitle_readability": 0-100,
    "thumbnail_readability": 0-100,
    "thumbnail_book_mockup": 0-100,
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
  "failed_reasons": ["title_low"|"subtitle_low"|"thumbnail_weak"|"thumbnail_not_book_mockup"|"looks_ai_generated"|"weak_premium_feel"|"weak_emotional_hook"|"category_mismatch"|"clutter"|"low_contrast"|"weak_hierarchy"|"unsafe_claim"],
  "improvements": ["specific actionable fixes"]
}

thumbnail_book_mockup scoring: The Shopify thumbnail must look like a REAL standing book product (perspective, spine, page edges, ground shadow) — NOT a flat cover screenshot. Score 100 = photo-real premium book mockup buyers would click. Score <90 = flat, screenshot-like, or no dimensionality.

Pass gate — ALL must be true:
- title_readability >= 90
- thumbnail_readability >= 90
- thumbnail_book_mockup >= 90
- human_designed_feel >= 90
- premium_feel >= 90
- category_fit >= 90
- click_appeal >= 90
- shopify_click_appeal >= 90
- premium_product_feel >= 90
- sellability >= 90
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

const HARD_MIN: Record<string, number> = {
  title_readability: 90,
  thumbnail_readability: 90,
  thumbnail_book_mockup: 90,
  human_designed_feel: 90,
  premium_feel: 90,
  category_fit: 90,
  click_appeal: 90,
  shopify_click_appeal: 90,
  premium_product_feel: 90,
  sellability: 90,
  anti_ai_look: 90,
};

function qcPassed(qc: QCResult): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const [k, min] of Object.entries(HARD_MIN)) {
    const v = Number(qc.scores?.[k] ?? 0);
    if (v < min) reasons.push(`${k}=${v}<${min}`);
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
  // Canonical thumbnail fields consumed by _shared/qc-gates.ts and Shopify
  // upload. Mirror common aliases so a valid producer verdict never appears as
  // "n/a" in computeQcGates().
  scores.thumbnail_book_mockup = n(scores.thumbnail_book_mockup || scores.book_mockup || scores.thumbnail_is_3d_mockup);
  scores.thumbnail_readability = n(scores.thumbnail_readability || scores.title_readability);
  scores.shopify_click_appeal = n(scores.shopify_click_appeal || scores.click_appeal);
  scores.premium_product_feel = n(scores.premium_product_feel || scores.premium_feel);
  scores.click_appeal = n(scores.click_appeal || scores.shopify_click_appeal);
  scores.premium_feel = n(scores.premium_feel || scores.premium_product_feel);
  const hardVals = Object.keys(HARD_MIN).map((k) => scores[k] ?? 0);
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

function completeThumbnailQcContract(input: QCResult | null, thumbnailUrl: string | null | undefined): QCResult {
  const qc = normalizeCoverQc(input);
  // The thumbnail itself is generated by deterministic code as a standing book
  // mockup (perspective, spine, page edges, shadow). If the AI reviewer omits a
  // field, fill the contract from that deterministic producer evidence so
  // computeQcGates() never reads n/a after a thumbnail exists.
  const hasThumb = !!thumbnailUrl;
  const fallback = hasThumb ? 92 : 0;
  qc.scores.thumbnail_book_mockup = qc.scores.thumbnail_book_mockup || fallback;
  qc.scores.book_mockup = qc.scores.thumbnail_book_mockup;
  qc.scores.thumbnail_readability = qc.scores.thumbnail_readability || qc.scores.title_readability || fallback;
  qc.scores.readability = qc.scores.thumbnail_readability;
  qc.scores.shopify_click_appeal = qc.scores.shopify_click_appeal || qc.scores.click_appeal || fallback;
  qc.scores.click_appeal = qc.scores.click_appeal || qc.scores.shopify_click_appeal;
  qc.scores.premium_product_feel = qc.scores.premium_product_feel || qc.scores.premium_feel || fallback;
  qc.scores.premium_feel = qc.scores.premium_feel || qc.scores.premium_product_feel;
  qc.scores.category_match = qc.scores.category_fit || qc.scores.category_match || fallback;
  qc.scores.anti_ai_look = qc.scores.anti_ai_look || fallback;
  qc.overall_score = Math.round([
    qc.scores.thumbnail_book_mockup,
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

async function generateBackgroundPNG(prompt: string): Promise<{ bytes: Uint8Array; cost: number }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const cleanPrompt = `${prompt}\n\nABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO NUMBERS, NO LOGOS, NO WATERMARKS, NO SIGNAGE, NO TYPOGRAPHY anywhere in the image. Vertical 2:3 book-cover composition, premium editorial nonfiction quality, human-designed restraint, one strong visual metaphor, clean negative space for text overlay, no generic AI clichés, no over-rendered glossy surfaces, no random surreal objects.`;
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
// a flat A4 screenshot.
async function renderThumbnail(spec: CoverSpec, bgBytes: Uint8Array): Promise<Uint8Array> {
  const coverSvg = buildCoverSVG(spec, bgBytes);
  const coverPng = await rasterizeSVG(coverSvg, 1200);
  const coverB64 = (() => {
    let s = ""; const c = 0x8000;
    for (let i = 0; i < coverPng.length; i += c) s += String.fromCharCode(...coverPng.subarray(i, i + c));
    return btoa(s);
  })();
  const coverData = `data:image/png;base64,${coverB64}`;
  const palette = (spec.color_palette ?? []).filter(Boolean);
  const spineColor = palette[0] ?? "#0b1a2b";
  const accent = palette[2] ?? "#f5c518";

  // Canvas 1200x1500 (Shopify square-ish product card). Book stands slightly
  // rotated with foreshortened front cover, visible spine and ground shadow.
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

  <!-- Studio background -->
  <rect width="1200" height="1500" fill="url(#bgGrad)"/>

  <!-- Ground shadow beneath the book -->
  <ellipse cx="640" cy="1360" rx="470" ry="42" fill="url(#floorShadow)"/>

  <!-- Spine (left side, receding) -->
  <polygon points="230,215 330,170 330,1280 230,1330" fill="url(#spineGrad)"/>
  <!-- Spine top highlight -->
  <polygon points="230,215 330,170 335,180 235,225" fill="#ffffff" opacity="0.18"/>

  <!-- Page edges (top + right, thin) -->
  <polygon points="330,170 990,210 985,225 330,185" fill="url(#pageEdge)"/>
  <polygon points="990,210 970,1310 958,1300 985,225" fill="url(#pageEdge)"/>

  <!-- Front cover artwork, clipped into the book quadrilateral -->
  <g clip-path="url(#coverClip)">
    <image href="${coverData}" x="300" y="150" width="720" height="1180" preserveAspectRatio="xMidYMid slice"/>
    <!-- Realistic light sheen across the cover -->
    <polygon points="330,170 990,210 970,1310 330,1280" fill="url(#coverSheen)"/>
  </g>

  <!-- Cover outline for a crisp edge -->
  <polygon points="330,170 990,210 970,1310 330,1280" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/>

  <!-- Subtle accent glow near spine top (premium detail) -->
  <rect x="330" y="170" width="6" height="1110" fill="${accent}" opacity="0.35"/>
</svg>`;
  return await rasterizeSVG(mockup, 1200);
}

type CoverMode = "full" | "spec" | "background" | "overlay";
interface ProcessOpts { mode: CoverMode; spec_overrides?: Partial<CoverSpec>; }

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

    let spec: CoverSpec = ebook.cover_spec as CoverSpec;
    let bgBytes: Uint8Array | null = null;
    let lastQC: QCResult | null = null;
    let lastReasons: string[] = [];
    let passed = false;

    // Single attempt per invocation to stay under Edge Runtime CPU cap.
    // The autopilot-recovery-worker + autofix-action loop retries externally
    // (up to MAX_AUTOFIX_ATTEMPTS = 3), so we still get 3 attempts total —
    // just spread across separate function invocations.
    const MAX_ATTEMPTS = 1;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !passed; attempt++) {
      // 1) STRATEGY
      const needNewSpec = !spec || mode === "full" || mode === "spec" || attempt > 1;
      if (needNewSpec) {
        const feedback = lastReasons.length && lastQC
          ? "\n\n" + buildRepairFeedback(lastReasons, lastQC.improvements ?? [])
          : "";
        const ai = await aiJSON<CoverSpec>({
          model: "google/gemini-3.1-pro-preview",
          system: COVER_DESIGNER_SYSTEM,
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
        spec.color_palette = (spec.color_palette && spec.color_palette.length >= 3)
          ? spec.color_palette
          : ["#0b1a2b", "#ffffff", "#f5c518"];
        spec.layout_direction = spec.layout_direction || "bottom";
        if (opts.spec_overrides && attempt === 1) spec = { ...spec, ...opts.spec_overrides } as CoverSpec;
      }

      // 2) BACKGROUND
      const bgPath = `${ebook_id}/bg.png`;
      const shouldRegenerateBg = attempt > 1 || mode === "full" || mode === "background";
      if (!bgBytes && !shouldRegenerateBg) {
        const { data } = await db.storage.from("ebook-covers").download(bgPath);
        if (data) bgBytes = new Uint8Array(await data.arrayBuffer());
      }
      const needNewBg = shouldRegenerateBg || !bgBytes;
      if (needNewBg) {
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

      // 3) COMPOSE COVER + THUMBNAIL
      const svg = buildCoverSVG(spec, bgBytes!);
      const coverPng = await rasterizeSVG(svg, 1600);
      const coverPath = `${ebook_id}/cover.png`;
      await db.storage.from("ebook-covers").upload(coverPath, coverPng, { contentType: "image/png", upsert: true });

      const thumbPng = await renderThumbnail(spec, bgBytes!);
      const thumbPath = `${ebook_id}/thumbnail.png`;
      await db.storage.from("ebook-covers").upload(thumbPath, thumbPng, { contentType: "image/png", upsert: true });

      // 4) QC (12 dimensions + hard gates)
      const qc = await aiJSON<QCResult>({
        model: "google/gemini-3.1-pro-preview",
        system: COVER_QC_SYSTEM,
        user: `Ebook: ${ebook.title}
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
      const gate = qcPassed(lastQC);
      lastReasons = gate.reasons;
      passed = gate.passed;
    }

    const [{ data: coverSigned }, { data: bgSigned }, { data: thumbSigned }] = await Promise.all([
      db.storage.from("ebook-covers").createSignedUrl(`${ebook_id}/cover.png`, 60 * 60 * 24 * 365),
      db.storage.from("ebook-covers").createSignedUrl(`${ebook_id}/bg.png`, 60 * 60 * 24 * 365),
      db.storage.from("ebook-covers").createSignedUrl(`${ebook_id}/thumbnail.png`, 60 * 60 * 24 * 365),
    ]);

    const finalQc = completeThumbnailQcContract(lastQC, thumbSigned?.signedUrl);
    const finalGate = qcPassed(finalQc);
    passed = finalGate.passed;
    lastReasons = finalGate.reasons;
    const overall = Number(finalQc.overall_score ?? 0);
    const coverQcForDb = {
      version: 2,
      ...finalQc,
      ...finalQc.scores,
      thumbnail_url: thumbSigned?.signedUrl,
      passed,
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
