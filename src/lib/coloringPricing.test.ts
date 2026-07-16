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

describe("coloring pricing — RULE 1 page count → base (owner table v2)", () => {
  it("maps anchor page counts exactly (incl. 4pp mini_test $1.99)", () => {
    expect(basePriceCents(4)).toBe(199);
    expect(basePriceCents(16)).toBe(599);
    expect(basePriceCents(24)).toBe(799);
    expect(basePriceCents(32)).toBe(999);
    expect(basePriceCents(48)).toBe(1299);
  });

  it("clamps below the smallest anchor and above the largest", () => {
    expect(basePriceCents(1)).toBe(199);
    expect(basePriceCents(120)).toBe(1299);
  });

  it("linearly interpolates between anchors", () => {
    // midpoint 16↔24 = 20 pages → (599+799)/2 = 699
    expect(basePriceCents(20)).toBe(699);
    // midpoint 24↔32 = 28 pages → (799+999)/2 = 899
    expect(basePriceCents(28)).toBe(899);
    // midpoint 32↔48 = 40 pages → (999+1299)/2 = 1149
    expect(basePriceCents(40)).toBe(1149);
  });
});

describe("coloring pricing — RULE 2 popularity tiers + ceiling/floor", () => {
  it("applies +40% for top10, +20% for top25, else base", () => {
    const p10 = computePrice({ pageCount: 32, tier: "top10" });
    const p25 = computePrice({ pageCount: 32, tier: "top25" });
    const pB = computePrice({ pageCount: 32, tier: "base" });
    expect(p10.price_cents).toBe(Math.round(999 * 1.4));
    expect(p25.price_cents).toBe(Math.round(999 * 1.2));
    expect(pB.price_cents).toBe(999);
  });

  it("enforces ceiling $16.99 and floor = base", () => {
    // 48pp base=1299, top10 → round(1299*1.4)=1819 → capped at 1699
    expect(computePrice({ pageCount: 48, tier: "top10" }).price_cents).toBe(1699);
    // custom config with lower ceiling
    const cfg = { ...DEFAULT_PRICING_CONFIG, ceiling_cents: 1400 };
    expect(computePrice({ pageCount: 48, tier: "top10", cfg }).price_cents).toBe(1400);
    // floor = base so price never drops below base even with sub-1 multiplier
    const oddCfg = {
      ...DEFAULT_PRICING_CONFIG,
      popularity: { ...DEFAULT_PRICING_CONFIG.popularity, top10_multiplier: 0.5 },
    };
    expect(computePrice({ pageCount: 32, tier: "top10", cfg: oddCfg }).price_cents).toBe(999);
  });

  it("popularityTier honors 10% / 25% cutoffs", () => {
    const scores = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]; // 10 books
    expect(popularityTier(100, scores)).toBe("top10"); // rank 1/10 = 10%
    expect(popularityTier(90, scores)).toBe("top25");  // rank 2/10, ceil(2.5)=3
    expect(popularityTier(80, scores)).toBe("top25");  // rank 3/10, within top25 cutoff
    expect(popularityTier(70, scores)).toBe("base");   // rank 4/10, past top25
    const s20 = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(popularityTier(20, s20)).toBe("top10"); // 1/20 = 5%
    expect(popularityTier(18, s20)).toBe("top25"); // 3/20 = 15%
    expect(popularityTier(10, s20)).toBe("base");  // 11/20 = 55%
  });

  it("zero-score books stay base regardless of ranking", () => {
    const signals = [
      { book_id: "a", category_key: "x", purchases: 50 },
      { book_id: "b", category_key: "x", purchases: 20 },
      { book_id: "c", category_key: "x", purchases: 10 },
      { book_id: "d", category_key: "x", purchases: 5 },
      { book_id: "e", category_key: "x", purchases: 4 },
      { book_id: "f", category_key: "x", purchases: 3 },
      { book_id: "g", category_key: "x", purchases: 2 },
      { book_id: "h", category_key: "x", purchases: 1 },
      { book_id: "z1", category_key: "x", purchases: 0 },
      { book_id: "z2", category_key: "x", purchases: 0 },
    ];
    const tiers = assignTiersForCategory(signals);
    expect(tiers.get("a")).toBe("top10");
    expect(tiers.get("b")).toBe("top25");
    expect(tiers.get("z1")).toBe("base");
    expect(tiers.get("z2")).toBe("base");
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
