import { describe, it, expect } from "vitest";
import {
  DEFAULT_PRICING_CONFIG,
  basePriceCents,
  computePrice,
  popularityTier,
  popularityScore,
  assignTiersForCategory,
  canReprice,
} from "../../supabase/functions/_shared/coloring/pricing";

describe("coloring pricing — RULE 1 page count → base", () => {
  it("maps anchor page counts exactly", () => {
    expect(basePriceCents(24)).toBe(399);
    expect(basePriceCents(32)).toBe(499);
    expect(basePriceCents(48)).toBe(699);
    expect(basePriceCents(64)).toBe(899);
  });

  it("clamps below the smallest anchor and above the largest", () => {
    expect(basePriceCents(8)).toBe(399);
    expect(basePriceCents(120)).toBe(899);
  });

  it("linearly interpolates between anchors", () => {
    // midpoint 24↔32 = 28 pages → (399+499)/2 = 449
    expect(basePriceCents(28)).toBe(449);
    // 40 pages between 32 and 48 → (499+699)/2 = 599
    expect(basePriceCents(40)).toBe(599);
    // 56 pages between 48 and 64 → (699+899)/2 = 799
    expect(basePriceCents(56)).toBe(799);
  });
});

describe("coloring pricing — RULE 2 popularity tiers + ceiling/floor", () => {
  it("applies +40% for top10, +20% for top25, else base", () => {
    const p10 = computePrice({ pageCount: 32, tier: "top10" });
    const p25 = computePrice({ pageCount: 32, tier: "top25" });
    const pB = computePrice({ pageCount: 32, tier: "base" });
    expect(p10.price_cents).toBe(Math.round(499 * 1.4));
    expect(p25.price_cents).toBe(Math.round(499 * 1.2));
    expect(pB.price_cents).toBe(499);
  });

  it("enforces ceiling $12.99 and floor = base", () => {
    // 64pp base=899, top10 → round(899*1.4)=1259 (below ceiling)
    expect(computePrice({ pageCount: 64, tier: "top10" }).price_cents).toBe(1259);
    // custom config with lower ceiling
    const cfg = { ...DEFAULT_PRICING_CONFIG, ceiling_cents: 1000 };
    expect(computePrice({ pageCount: 64, tier: "top10", cfg }).price_cents).toBe(1000);
    // multiplier <1 would never apply (base=1.0), but if someone forced a tier with <1, floor kicks in
    const oddCfg = {
      ...DEFAULT_PRICING_CONFIG,
      popularity: { ...DEFAULT_PRICING_CONFIG.popularity, top10_multiplier: 0.5 },
    };
    // floor = base so price stays 499 even with 0.5 mult
    expect(computePrice({ pageCount: 32, tier: "top10", cfg: oddCfg }).price_cents).toBe(499);
  });

  it("popularityTier honors 10% / 25% cutoffs", () => {
    const scores = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]; // 10 books
    expect(popularityTier(100, scores)).toBe("top10"); // rank 1/10 = 10%
    expect(popularityTier(90, scores)).toBe("top25");  // rank 2/10 = 20%
    expect(popularityTier(80, scores)).toBe("base");   // rank 3/10 = 30% > 25%
    expect(popularityTier(50, scores)).toBe("base");   // mid-pack
    const s20 = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(popularityTier(20, s20)).toBe("top10"); // 1/20 = 5%
    expect(popularityTier(18, s20)).toBe("top25"); // 3/20 = 15%
    expect(popularityTier(10, s20)).toBe("base");  // 11/20 = 55%
  });

  it("zero-score books stay base regardless of ranking", () => {
    const tiers = assignTiersForCategory([
      { book_id: "a", category_key: "x", purchases: 5 },
      { book_id: "b", category_key: "x", purchases: 0 },
      { book_id: "c", category_key: "x", purchases: 0 },
    ]);
    expect(tiers.get("a")).toBe("top10");
    expect(tiers.get("b")).toBe("base");
    expect(tiers.get("c")).toBe("base");
  });

  it("popularityScore weights purchases 10x, previews 3x, views 1x", () => {
    expect(popularityScore({ book_id: "z", category_key: null, views: 10, previews: 5, purchases: 2 }))
      .toBe(10 * 1 + 5 * 3 + 2 * 10);
  });
});

describe("coloring pricing — repricer cooldown (idempotent same-day)", () => {
  it("blocks reprice within 24h; allows after", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    expect(canReprice(null, DEFAULT_PRICING_CONFIG, now)).toBe(true);
    expect(canReprice("2026-07-16T05:00:00Z", DEFAULT_PRICING_CONFIG, now)).toBe(false); // 7h ago
    expect(canReprice("2026-07-15T11:00:00Z", DEFAULT_PRICING_CONFIG, now)).toBe(true);  // 25h ago
  });
});
