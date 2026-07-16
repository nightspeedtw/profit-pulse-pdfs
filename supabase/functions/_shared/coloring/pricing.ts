// Coloring Book Pricing — owner pricing law.
// RULE 1 (page count → base): linear interp across anchor table.
// RULE 2 (popularity → multiplier): top 10% +40%, top 25% +20%, else base.
// Ceiling $16.99, floor = base. Data-driven; config lives in
// generation_settings.coloring_autopilot.pricing.
//
// Pure module — no I/O, no Deno globals. Runs in vitest (node) and Deno.

export type PricingAnchor = { pages: number; price_cents: number };

export type PricingConfig = {
  anchors: PricingAnchor[];           // page-count → base cents
  ceiling_cents: number;              // hard cap after popularity
  popularity: {
    top10_multiplier: number;         // e.g. 1.40
    top25_multiplier: number;         // e.g. 1.20
    weights: {                        // event-type → weight
      view: number;
      preview: number;
      purchase: number;
    };
    lookback_days: number;
    reprice_cooldown_hours: number;   // e.g. 24
  };
};

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  anchors: [
    { pages: 4,  price_cents: 199 },  // mini_test format (owner-run smoke tests)
    { pages: 16, price_cents: 599 },
    { pages: 24, price_cents: 799 },
    { pages: 32, price_cents: 999 },
    { pages: 48, price_cents: 1299 },
  ],
  ceiling_cents: 1699,
  popularity: {
    top10_multiplier: 1.40,
    top25_multiplier: 1.20,
    weights: { view: 1, preview: 3, purchase: 10 },
    lookback_days: 30,
    reprice_cooldown_hours: 24,
  },
};

export type PopularityTier = "top10" | "top25" | "base";

/** Linear interpolation across the sorted anchor table. Clamps at ends. */
export function basePriceCents(pageCount: number, cfg: PricingConfig = DEFAULT_PRICING_CONFIG): number {
  const anchors = [...cfg.anchors].sort((a, b) => a.pages - b.pages);
  if (anchors.length === 0) return 499;
  if (pageCount <= anchors[0].pages) return anchors[0].price_cents;
  const last = anchors[anchors.length - 1];
  if (pageCount >= last.pages) return last.price_cents;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (pageCount >= a.pages && pageCount <= b.pages) {
      const t = (pageCount - a.pages) / (b.pages - a.pages);
      return Math.round(a.price_cents + t * (b.price_cents - a.price_cents));
    }
  }
  return last.price_cents;
}

export function multiplierForTier(tier: PopularityTier, cfg: PricingConfig = DEFAULT_PRICING_CONFIG): number {
  if (tier === "top10") return cfg.popularity.top10_multiplier;
  if (tier === "top25") return cfg.popularity.top25_multiplier;
  return 1.0;
}

/**
 * Assign a tier for a book given the full sorted popularity scores of its
 * category (descending). Uses ceil-based cutoffs so at least 1 book earns
 * top10 whenever any nonzero signal exists.
 */
export function popularityTier(score: number, sortedScoresDesc: number[]): PopularityTier {
  const n = sortedScoresDesc.length;
  if (n === 0 || score <= 0) return "base";
  const rank = sortedScoresDesc.findIndex((s) => s <= score) + 1;
  const top10Cut = Math.max(1, Math.ceil(n * 0.10));
  const top25Cut = Math.max(1, Math.ceil(n * 0.25));
  if (rank <= top10Cut) return "top10";
  if (rank <= top25Cut) return "top25";
  return "base";
}

export type PricingBreakdown = {
  base_cents: number;
  page_count: number;
  popularity_tier: PopularityTier;
  multiplier: number;
  ceiling_cents: number;
  price_cents: number;
  computed_at: string;
};

/** Compose the final price + breakdown. Floor = base, ceiling from config. */
export function computePrice(input: {
  pageCount: number;
  tier?: PopularityTier;
  cfg?: PricingConfig;
  now?: () => Date;
}): PricingBreakdown {
  const cfg = input.cfg ?? DEFAULT_PRICING_CONFIG;
  const tier: PopularityTier = input.tier ?? "base";
  const base = basePriceCents(input.pageCount, cfg);
  const mult = multiplierForTier(tier, cfg);
  const raw = Math.round(base * mult);
  const capped = Math.min(cfg.ceiling_cents, Math.max(base, raw));
  const now = (input.now ?? (() => new Date()))().toISOString();
  return {
    base_cents: base,
    page_count: input.pageCount,
    popularity_tier: tier,
    multiplier: mult,
    ceiling_cents: cfg.ceiling_cents,
    price_cents: capped,
    computed_at: now,
  };
}

export type PopularitySignal = {
  book_id: string;
  category_key: string | null;
  views?: number;
  previews?: number;
  purchases?: number;
};

export function popularityScore(sig: PopularitySignal, cfg: PricingConfig = DEFAULT_PRICING_CONFIG): number {
  const w = cfg.popularity.weights;
  return (sig.views ?? 0) * w.view + (sig.previews ?? 0) * w.preview + (sig.purchases ?? 0) * w.purchase;
}

/**
 * Given the last reprice ISO timestamp, has enough time passed?
 * Enforces "never reprice more than once/day".
 */
export function canReprice(lastRepriceAt: string | null, cfg: PricingConfig = DEFAULT_PRICING_CONFIG, now: Date = new Date()): boolean {
  if (!lastRepriceAt) return true;
  const last = new Date(lastRepriceAt).getTime();
  if (Number.isNaN(last)) return true;
  const hours = (now.getTime() - last) / 3_600_000;
  return hours >= cfg.popularity.reprice_cooldown_hours;
}

/**
 * Assign tiers across a category. Returns Map<book_id, tier>.
 * Books with score=0 stay base regardless of ranking.
 */
export function assignTiersForCategory(signals: PopularitySignal[], cfg: PricingConfig = DEFAULT_PRICING_CONFIG): Map<string, PopularityTier> {
  const out = new Map<string, PopularityTier>();
  const scored = signals.map((s) => ({ id: s.book_id, score: popularityScore(s, cfg) }));
  const nonzero = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const scoresDesc = nonzero.map((x) => x.score);
  for (const s of scored) {
    if (s.score <= 0) { out.set(s.id, "base"); continue; }
    out.set(s.id, popularityTier(s.score, scoresDesc));
  }
  return out;
}
