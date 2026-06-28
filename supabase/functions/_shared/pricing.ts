// Automatic Psychological Pricing Engine
//
// Deterministic pricing recommender that produces a snap-to-ladder
// recommended/launch/standard/low/high/bundle price + reasoning + confidence.
//
// No AI calls. Pure function of ebook + category signals.

export type PricingTier =
  | "Entry Guide"
  | "Standard Premium PDF"
  | "Premium Workbook / Playbook"
  | "Advanced System / Professional Toolkit"
  | "Bundle / Multi-PDF Product";

export interface PricingInputs {
  title?: string | null;
  category_slug?: string | null;
  category_name?: string | null;
  target_buyer?: string | null;
  // 0–10 unless noted
  buyer_pain_level?: number | null;       // 0–10
  buyer_urgency?: number | null;          // 0–10
  buyer_ability_to_pay?: number | null;   // 0–10
  topic_demand?: number | null;           // 0–10
  market_competition?: number | null;     // 0–10 (10 = saturated)
  word_count?: number | null;
  page_count?: number | null;
  chapter_count?: number | null;
  worksheet_count?: number | null;
  template_count?: number | null;
  diagram_count?: number | null;
  bonus_asset_count?: number | null;
  premium_score?: number | null;          // 0–100
  conversion_score?: number | null;       // 0–100
  cover_score?: number | null;            // 0–100
  compliance_risk_score?: number | null;  // 0–10 (10 = risky)
  refund_risk_score?: number | null;      // 0–10 (10 = risky)
  is_bundle?: boolean;
  // Optional live market range [low, high]
  comparable_market_price_range?: [number, number] | null;
}

export interface PricingReport {
  recommended_price: string;
  low_price_test: string;
  high_price_test: string;
  pricing_tier: PricingTier;
  pricing_reason: string;
  buyer_psychology_reason: string;
  market_positioning: string;
  discount_allowed: boolean;
  launch_price: string;
  standard_price: string;
  bundle_price_recommendation: string;
  price_confidence_score: number; // 0–100
  scores: Record<string, number>;
  category_range: [number, number];
  tier_range: [number, number];
  ladder_used: number[];
  needs_admin_attention: boolean;
}

// Allowed psychological ladder.
const PRICE_LADDER = [
  9.99, 12.99, 14.99, 17.99, 19.99, 24.99, 27.99, 29.99,
  34.99, 39.99, 49.99, 59.99, 79.99, 99.99,
];

// Category → [low, high]. Slugs come from /categories.
const CATEGORY_RANGES: Record<string, [number, number]> = {
  "secret-ai":            [27.99, 49.99],
  "ai-automation":        [27.99, 49.99],
  "secret-business":      [29.99, 49.99],
  "business":             [29.99, 49.99],
  "secret-marketing":     [24.99, 49.99],
  "marketing":            [24.99, 49.99],
  "personal-finance":     [19.99, 39.99],
  "secret-finance":       [19.99, 39.99],
  "secret-money":         [19.99, 39.99],
  "debt-budgeting":       [17.99, 34.99],
  "career-side-hustle":   [19.99, 39.99],
  "secret-career":        [19.99, 39.99],
  "productivity":         [14.99, 29.99],
  "secret-productivity":  [14.99, 29.99],
  "relationships":        [14.99, 29.99],
  "secret-relationships": [14.99, 29.99],
  "health-wellness":      [14.99, 29.99],
  "lifestyle":            [9.99, 24.99],
};

const DEFAULT_CATEGORY_RANGE: [number, number] = [14.99, 29.99];

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function n(v: unknown, d = 0): number { const x = Number(v); return Number.isFinite(x) ? x : d; }

function snapToLadder(target: number, range: [number, number]): number {
  const [lo, hi] = range;
  const pool = PRICE_LADDER.filter((p) => p >= lo && p <= hi);
  const list = pool.length ? pool : PRICE_LADDER;
  let best = list[0]; let bestD = Math.abs(list[0] - target);
  for (const p of list) {
    const d = Math.abs(p - target);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function lowerOnLadder(p: number): number {
  const i = PRICE_LADDER.indexOf(p);
  if (i <= 0) return PRICE_LADDER[0];
  return PRICE_LADDER[i - 1];
}
function higherOnLadder(p: number): number {
  const i = PRICE_LADDER.indexOf(p);
  if (i < 0 || i >= PRICE_LADDER.length - 1) return PRICE_LADDER[PRICE_LADDER.length - 1];
  return PRICE_LADDER[i + 1];
}

function pickTier(input: PricingInputs, contentDepth: number, bonusValue: number): PricingTier {
  if (input.is_bundle) return "Bundle / Multi-PDF Product";
  const cat = (input.category_slug ?? "").toLowerCase();
  const advanced = ["secret-ai", "ai-automation", "secret-business", "business",
                    "secret-marketing", "marketing", "secret-career", "career-side-hustle",
                    "secret-finance", "personal-finance"].includes(cat);
  if (advanced && contentDepth >= 70 && (input.premium_score ?? 0) >= 80) {
    return "Advanced System / Professional Toolkit";
  }
  if (bonusValue >= 60 && contentDepth >= 55) {
    return "Premium Workbook / Playbook";
  }
  if (contentDepth >= 50) return "Standard Premium PDF";
  return "Entry Guide";
}

const TIER_RANGES: Record<PricingTier, [number, number]> = {
  "Entry Guide": [9.99, 14.99],
  "Standard Premium PDF": [17.99, 29.99],
  "Premium Workbook / Playbook": [27.99, 39.99],
  "Advanced System / Professional Toolkit": [34.99, 49.99],
  "Bundle / Multi-PDF Product": [59.99, 99.99],
};

export function computePricing(input: PricingInputs): PricingReport {
  // Defaults — treat unknown signals as "medium" instead of 0 so we don't
  // collapse to floor pricing on a brand-new ebook with sparse metadata.
  const pain    = n(input.buyer_pain_level, 6);
  const urgency = n(input.buyer_urgency, 6);
  const ability = n(input.buyer_ability_to_pay, 6);
  const demand  = n(input.topic_demand, 6);
  const compete = n(input.market_competition, 5);
  const premium = n(input.premium_score, 75);
  const conv    = n(input.conversion_score, 75);
  const cover   = n(input.cover_score, 75);
  const comply  = n(input.compliance_risk_score, 2);
  const refund  = n(input.refund_risk_score, 3);

  const words    = n(input.word_count, 0);
  const pages    = n(input.page_count, 0);
  const chapters = n(input.chapter_count, 0);
  const sheets   = n(input.worksheet_count, 0);
  const tmpls    = n(input.template_count, 0);
  const diagrams = n(input.diagram_count, 0);
  const bonus    = n(input.bonus_asset_count, 0);

  // ---- 0–100 sub-scores ----
  const marketDemand = clamp(demand * 10, 0, 100);
  const buyerPain    = clamp(pain * 10, 0, 100);
  const buyerAbility = clamp(ability * 10, 0, 100);
  // Content depth: words (cap 25k), pages (cap 80), chapters (cap 20).
  const contentDepth = clamp(
    (Math.min(words, 25_000) / 25_000) * 60 +
    (Math.min(pages, 80) / 80) * 25 +
    (Math.min(chapters, 20) / 20) * 15,
    0, 100,
  );
  // Bonus asset value: worksheets + templates + diagrams + bonus.
  const bonusValue = clamp(
    Math.min(sheets, 10) * 4 +
    Math.min(tmpls, 10) * 4 +
    Math.min(diagrams, 10) * 3 +
    Math.min(bonus, 5) * 4,
    0, 100,
  );
  const premiumPerception = clamp(premium * 0.6 + cover * 0.2 + conv * 0.2, 0, 100);
  const competitionPressure = clamp(compete * 10, 0, 100);
  const refundRisk = clamp(refund * 10, 0, 100);

  // ---- Tier + category range ----
  const catSlug = (input.category_slug ?? "").toLowerCase();
  const catRange = CATEGORY_RANGES[catSlug] ?? DEFAULT_CATEGORY_RANGE;
  const tier = pickTier(input, contentDepth, bonusValue);
  let [lo, hi] = TIER_RANGES[tier];
  // Intersect with category range (but never collapse to empty — fall back to tier).
  const interLo = Math.max(lo, catRange[0]);
  const interHi = Math.min(hi, catRange[1]);
  if (interLo <= interHi) { lo = interLo; hi = interHi; }

  // ---- Position within range (0..1) ----
  // Composite "premium pull" pushes toward upper end.
  const pull = clamp(
    (marketDemand * 0.20 +
     buyerPain * 0.18 +
     contentDepth * 0.18 +
     premiumPerception * 0.20 +
     bonusValue * 0.14 +
     buyerAbility * 0.10) / 100,
    0, 1,
  );
  // Dampeners.
  let damp = 0;
  if (refundRisk >= 60) damp += 0.15;
  if (competitionPressure >= 70) damp += 0.10;
  if (comply >= 6) damp += 0.10;
  if (urgency <= 3) damp += 0.05;
  const position = clamp(pull - damp, 0, 1);

  // ---- Market data override (if available) ----
  let target = lo + (hi - lo) * position;
  if (input.comparable_market_price_range) {
    const [mlo, mhi] = input.comparable_market_price_range;
    const blend = (mlo + mhi) / 2;
    target = (target + blend) / 2;
  }

  const recommended = snapToLadder(target, [lo, hi]);
  const high = higherOnLadder(recommended);
  const low = lowerOnLadder(recommended);
  // Launch price: one ladder step below standard (recommended) — unless already at floor.
  const standard = recommended;
  const launch = lowerOnLadder(standard);
  const bundle = snapToLadder(standard * 2.2, [59.99, 99.99]);

  // ---- Confidence (0–100) ----
  // Signals present?
  const present = [
    input.premium_score, input.conversion_score, input.cover_score,
    input.word_count, input.page_count, input.chapter_count,
    input.buyer_pain_level, input.topic_demand, input.category_slug,
  ].filter((v) => v !== null && v !== undefined && v !== "").length;
  const coverage = (present / 9) * 100;
  // Position confidence — high when pull is decisive (far from 0.5).
  const decisiveness = Math.abs(position - 0.5) * 200; // 0..100
  let confidence = clamp(
    coverage * 0.55 + decisiveness * 0.25 + premiumPerception * 0.20,
    0, 100,
  );
  if (refundRisk >= 70 || comply >= 7) confidence = clamp(confidence - 15, 0, 100);
  if (input.comparable_market_price_range) confidence = clamp(confidence + 8, 0, 100);
  confidence = Math.round(confidence);

  // ---- Reasoning strings ----
  const reasonBits: string[] = [];
  if (contentDepth >= 70) reasonBits.push("deep content (long-form + many chapters)");
  else if (contentDepth >= 50) reasonBits.push("solid content depth");
  else reasonBits.push("lighter scope — entry-level depth");
  if (bonusValue >= 60) reasonBits.push("strong worksheet/template/framework value");
  else if (bonusValue >= 30) reasonBits.push("some practical assets");
  if (pain >= 7) reasonBits.push("high buyer pain");
  if (demand >= 7) reasonBits.push("strong topic demand");
  if (premiumPerception >= 80) reasonBits.push("premium perception score");
  if (refundRisk >= 60) reasonBits.push("refund risk → keep price approachable");
  if (comply >= 6) reasonBits.push("compliance risk → no aggressive premium");

  const positioning =
    position >= 0.7 ? "Premium and confident"
    : position >= 0.45 ? "Premium but accessible"
    : "Approachable / entry";

  const buyerPsych = position >= 0.6
    ? "Sits in the impulse-purchase digital range but high enough to signal premium value, with a .99 anchor."
    : position >= 0.35
    ? "Low enough for an easy digital impulse buy while still feeling like a real product, not a freebie."
    : "Frictionless entry price — designed to convert quickly and earn the upsell.";

  return {
    recommended_price: recommended.toFixed(2),
    low_price_test: low.toFixed(2),
    high_price_test: high.toFixed(2),
    pricing_tier: tier,
    pricing_reason: reasonBits.join(", ") || "Balanced default pricing.",
    buyer_psychology_reason: buyerPsych,
    market_positioning: positioning,
    discount_allowed: comply < 7,
    launch_price: launch.toFixed(2),
    standard_price: standard.toFixed(2),
    bundle_price_recommendation: bundle.toFixed(2),
    price_confidence_score: confidence,
    scores: {
      market_demand: Math.round(marketDemand),
      buyer_pain: Math.round(buyerPain),
      buyer_ability_to_pay: Math.round(buyerAbility),
      content_depth: Math.round(contentDepth),
      bonus_asset_value: Math.round(bonusValue),
      premium_perception: Math.round(premiumPerception),
      competition_pressure: Math.round(competitionPressure),
      refund_risk: Math.round(refundRisk),
      price_confidence: confidence,
    },
    category_range: catRange,
    tier_range: TIER_RANGES[tier],
    ladder_used: PRICE_LADDER.filter((p) => p >= lo && p <= hi),
    needs_admin_attention: confidence < 85,
  };
}
