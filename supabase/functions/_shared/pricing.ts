// Pricing engine.
//
// Two APIs live here:
//   1) computePricing(PricingInputs) → PricingReport  — the full pricing report
//      used by the compute-pricing edge function (launch / standard / bundle
//      etc.). Keep this signature stable; compute-pricing/index.ts depends on it.
//   2) computeListingPrice(ListingPricingInputs) → ListingPricingResult — the
//      simpler category-aware auto-price used by auto-list-ebook for the new
//      internal store, backed by the category style profile's price band.
import { resolveStyleProfile, type StyleProfile } from "./thumbnail-style-system.ts";

// ---------- 1) Full pricing report (existing consumer contract) ----------

export interface PricingInputs {
  title?: string | null;
  category_slug?: string | null;
  category_name?: string | null;
  target_buyer?: string | null;
  buyer_pain_level?: number | null;
  buyer_urgency?: number | null;
  buyer_ability_to_pay?: number | null;
  topic_demand?: number | null;
  market_competition?: number | null;
  word_count?: number | null;
  page_count?: number | null;
  chapter_count?: number | null;
  worksheet_count?: number | null;
  template_count?: number | null;
  diagram_count?: number | null;
  bonus_asset_count?: number | null;
  premium_score?: number | null;
  conversion_score?: number | null;
  cover_score?: number | null;
  compliance_risk_score?: number | null;
  refund_risk_score?: number | null;
  is_bundle?: boolean;
  comparable_market_price_range?: [number, number] | null;
}

export type PricingTier = "starter" | "standard" | "premium" | "toolkit" | "bundle";

export interface PricingReport {
  recommended_price: number;
  launch_price: number;
  standard_price: number;
  low_price_test: number;
  high_price_test: number;
  bundle_price_recommendation: number;
  pricing_tier: PricingTier;
  price_confidence_score: number; // 0–100
  category_slug: string;
  band: { min: number; max: number };
  rationale: Array<{ factor: string; delta: number; note: string }>;
  currency: "USD";
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function nice(n: number): number {
  if (n <= 0) return 0;
  const f = Math.floor(n);
  return f + 0.99;
}
function s10(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return n > 10 ? Math.max(0, Math.min(10, n / 10)) : Math.max(0, Math.min(10, n));
}

export function computePricing(input: PricingInputs): PricingReport {
  const profile: StyleProfile = resolveStyleProfile({
    category_slug: input.category_slug,
    category_name: input.category_name,
    title: input.title,
  });
  const band = profile.price_band;
  const mid = (band.min + band.max) / 2;

  const rationale: PricingReport["rationale"] = [];
  let base = mid;

  // Buyer signals (0–10 each)
  const pain = s10(input.buyer_pain_level);
  const urgency = s10(input.buyer_urgency);
  const ability = s10(input.buyer_ability_to_pay);
  const demand = s10(input.topic_demand);
  const competition = s10(input.market_competition);

  const buyerDelta = ((pain + urgency + ability + demand - competition) / 10) * 4;
  if (Math.abs(buyerDelta) >= 0.5) rationale.push({
    factor: "buyer_signals",
    delta: Math.round(buyerDelta * 100) / 100,
    note: `pain=${pain} urgency=${urgency} pay=${ability} demand=${demand} comp=${competition}`,
  });
  base += buyerDelta;

  // Length & content depth
  const wc = Math.max(0, Number(input.word_count ?? 0));
  if (wc >= 25000) { base += 6; rationale.push({ factor: "length", delta: 6, note: `${wc.toLocaleString()} words` }); }
  else if (wc >= 12000) { base += 3; rationale.push({ factor: "length", delta: 3, note: `${wc.toLocaleString()} words` }); }
  else if (wc > 0 && wc < 5000) { base -= 3; rationale.push({ factor: "length", delta: -3, note: `${wc.toLocaleString()} words (mini)` }); }

  const worksheets = Number(input.worksheet_count ?? 0) + Number(input.template_count ?? 0);
  if (worksheets >= 5) { base += 6; rationale.push({ factor: "toolkit", delta: 6, note: `${worksheets} worksheets/templates` }); }
  else if (worksheets >= 1) { base += 2; rationale.push({ factor: "toolkit", delta: 2, note: `${worksheets} worksheets` }); }

  const bonus = Number(input.bonus_asset_count ?? 0);
  if (bonus >= 3) { base += 3; rationale.push({ factor: "bonus", delta: 3, note: `${bonus} bonus assets` }); }

  // Quality
  const q = Number(input.premium_score ?? 0);
  if (q >= 92) { base += 4; rationale.push({ factor: "quality", delta: 4, note: `premium score ${q}` }); }
  else if (q >= 85) { base += 2; rationale.push({ factor: "quality", delta: 2, note: `high score ${q}` }); }

  // Compliance / refund risk pushes down
  const compliance = Number(input.compliance_risk_score ?? 0);
  if (compliance >= 7) { base -= 3; rationale.push({ factor: "compliance", delta: -3, note: "high sensitivity" }); }
  const refund = Number(input.refund_risk_score ?? 0);
  if (refund >= 7) { base -= 2; rationale.push({ factor: "refund_risk", delta: -2, note: "high refund risk" }); }

  // Comparable market range
  const cmp = input.comparable_market_price_range;
  if (cmp && cmp.length === 2) {
    const mkt = (cmp[0] + cmp[1]) / 2;
    const pull = (mkt - base) * 0.3;
    if (Math.abs(pull) >= 0.5) {
      base += pull;
      rationale.push({ factor: "market", delta: Math.round(pull * 100) / 100, note: `comparable $${cmp[0]}–$${cmp[1]}` });
    }
  }

  const standard = clamp(base, band.min, band.max);
  const recommended = standard;
  const launch = clamp(standard * 0.7, band.min * 0.7, band.max);
  const low = clamp(standard * 0.55, 4, band.max);
  const high = clamp(standard * 1.35, band.min, band.max * 1.35);
  const bundleRec = Math.max(79, standard * 2.4);

  // Tier
  let tier: PricingTier = "standard";
  if (input.is_bundle) tier = "bundle";
  else if (worksheets >= 5) tier = "toolkit";
  else if (recommended <= 14) tier = "starter";
  else if (recommended >= 29 || q >= 90) tier = "premium";

  // Confidence: more signals + higher quality → higher confidence
  const signalCount = [input.word_count, input.premium_score, input.buyer_pain_level, input.topic_demand, cmp]
    .filter(v => v !== null && v !== undefined).length;
  const confidence = clamp(40 + signalCount * 10 + Math.round(q / 5), 30, 95);

  return {
    recommended_price: nice(recommended),
    launch_price: nice(launch),
    standard_price: nice(standard),
    low_price_test: nice(low),
    high_price_test: nice(high),
    bundle_price_recommendation: nice(bundleRec),
    pricing_tier: tier,
    price_confidence_score: confidence,
    category_slug: profile.slug,
    band,
    rationale,
    currency: "USD",
  };
}

// ---------- 2) Simple auto-list pricing (new internal store) ----------

export interface ListingPricingInputs {
  category_slug?: string | null;
  category_name?: string | null;
  title?: string | null;
  word_count?: number | null;
  illustration_count?: number | null;
  worksheet_count?: number | null;
  final_quality_score?: number | null;
  product_format?: string | null;
}

export interface ListingPricingResult {
  price: number;
  compare_at_price: number | null;
  rationale: PricingReport;
}

export function computeListingPrice(input: ListingPricingInputs): ListingPricingResult {
  const report = computePricing({
    title: input.title,
    category_slug: input.category_slug,
    category_name: input.category_name,
    word_count: input.word_count,
    worksheet_count: input.worksheet_count,
    diagram_count: input.illustration_count,
    premium_score: input.final_quality_score,
    is_bundle: (input.product_format ?? "").toLowerCase() === "bundle",
  });
  return {
    price: report.recommended_price,
    compare_at_price: null,
    rationale: report,
  };
}
