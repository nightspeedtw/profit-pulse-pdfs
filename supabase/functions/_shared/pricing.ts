// Auto pricing engine — computes a recommended USD price for an ebook based on
// category, size, quality, and product format. Returns a numeric price plus a
// structured rationale that the admin UI can display and override.
import { resolveStyleProfile, type StyleProfile } from "./thumbnail-style-system.ts";

export interface PricingInputs {
  category_slug?: string | null;
  category_name?: string | null;
  title?: string | null;
  subtitle?: string | null;
  word_count?: number | null;
  illustration_count?: number | null;
  worksheet_count?: number | null;
  final_quality_score?: number | null;
  product_format?: string | null;      // "ebook" | "toolkit" | "bundle" | "mini"
  compliance_sensitive?: boolean;
}

export interface PricingResult {
  price: number;
  compare_at_price: number | null;
  currency: "USD";
  rationale: {
    category: string;
    profile_band: { min: number; max: number };
    factors: Array<{ name: string; delta: number; note: string }>;
    base_price: number;
    computed_price: number;
    quality_bonus_applied: boolean;
    format: string;
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function niceRound(n: number): number {
  if (n <= 0) return 0;
  // round to nearest .99 or .00 depending on band
  const floor = Math.floor(n);
  return floor + 0.99;
}

export function computePricing(input: PricingInputs): PricingResult {
  const profile: StyleProfile = resolveStyleProfile({
    category_slug: input.category_slug,
    category_name: input.category_name,
    title: input.title,
    subtitle: input.subtitle,
  });

  const band = profile.price_band;
  let base = (band.min + band.max) / 2;
  const factors: PricingResult["rationale"]["factors"] = [];

  // Size factor
  const wc = Math.max(0, Number(input.word_count ?? 0));
  if (wc >= 25000) { base += 6; factors.push({ name: "length", delta: 6, note: `${wc.toLocaleString()} words (long)` }); }
  else if (wc >= 12000) { base += 3; factors.push({ name: "length", delta: 3, note: `${wc.toLocaleString()} words (standard)` }); }
  else if (wc > 0 && wc < 5000) { base -= 3; factors.push({ name: "length", delta: -3, note: `${wc.toLocaleString()} words (mini)` }); }

  // Illustration factor (children / creative books)
  const ic = Math.max(0, Number(input.illustration_count ?? 0));
  if (ic >= 20) { base += 5; factors.push({ name: "illustrations", delta: 5, note: `${ic} illustrations` }); }
  else if (ic >= 8) { base += 2; factors.push({ name: "illustrations", delta: 2, note: `${ic} illustrations` }); }

  // Worksheets / toolkit bonus
  const ws = Math.max(0, Number(input.worksheet_count ?? 0));
  if (ws >= 5) { base += 8; factors.push({ name: "toolkit", delta: 8, note: `${ws} worksheets/templates` }); }
  else if (ws >= 1) { base += 3; factors.push({ name: "toolkit", delta: 3, note: `${ws} worksheets` }); }

  // Quality bonus
  const q = Number(input.final_quality_score ?? 0);
  let qualityBonus = false;
  if (q >= 92) { base += 4; qualityBonus = true; factors.push({ name: "quality", delta: 4, note: `Q${q} premium` }); }
  else if (q >= 88) { base += 2; qualityBonus = true; factors.push({ name: "quality", delta: 2, note: `Q${q} high` }); }

  // Format override
  const fmt = (input.product_format ?? "ebook").toLowerCase();
  if (fmt === "bundle") { base = Math.max(base + 40, 79); factors.push({ name: "format", delta: 40, note: "bundle" }); }
  else if (fmt === "toolkit") { base += 10; factors.push({ name: "format", delta: 10, note: "toolkit" }); }
  else if (fmt === "mini") { base = Math.min(base, 17); factors.push({ name: "format", delta: 0, note: "mini guide capped" }); }

  const computed = clamp(base, band.min, fmt === "bundle" ? 199 : band.max);
  const price = niceRound(computed);

  return {
    price,
    compare_at_price: null, // only truthful when admin enables it
    currency: "USD",
    rationale: {
      category: profile.slug,
      profile_band: band,
      factors,
      base_price: Math.round(((band.min + band.max) / 2) * 100) / 100,
      computed_price: Math.round(computed * 100) / 100,
      quality_bonus_applied: qualityBonus,
      format: fmt,
    },
  };
}
