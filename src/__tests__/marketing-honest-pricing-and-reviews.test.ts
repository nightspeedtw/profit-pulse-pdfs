import { describe, it, expect } from "vitest";
import {
  deriveSalePricing,
  derivePlatformReview,
  deriveEditorialQuality,
} from "@/lib/storefrontPricing";

// Marketing Autopilot — Phase 0 honest-pricing / honest-reviews regression.
// These invariants must never regress: no synthesized compare-at price,
// no fabricated customer-review count, no fake percentage-off.

describe("storefrontPricing honest-pricing law", () => {
  it("never synthesizes a compare-at price when meta has none", () => {
    for (const id of ["a", "b", "c", "d-longer-id", "00000000-0000-0000-0000-000000000000"]) {
      const p = deriveSalePricing(id, 999, null);
      expect(p.originalCents).toBeNull();
      expect(p.originalLabel).toBeNull();
      expect(p.discountPct).toBeNull();
      expect(p.hasDiscount).toBe(false);
      expect(p.priceLabel).toBe("$9.99");
    }
  });

  it("ignores compare-at values that lack the verified sentinel", () => {
    const p = deriveSalePricing("x", 599, { compare_at_price_cents: 1999 });
    expect(p.hasDiscount).toBe(false);
    expect(p.originalCents).toBeNull();
  });

  it("ignores legacy nested compare_at_cents that lack the verified sentinel", () => {
    const p = deriveSalePricing("x", 599, { pricing: { compare_at_cents: 1999 } });
    expect(p.hasDiscount).toBe(false);
  });

  it("only shows a strikethrough when compare_at_verified === true and value > price", () => {
    const p = deriveSalePricing("x", 599, {
      compare_at_price_cents: 1499,
      compare_at_verified: true,
    });
    expect(p.hasDiscount).toBe(true);
    expect(p.originalCents).toBe(1499);
    expect(p.discountPct).toBe(60);
    expect(p.originalLabel).toBe("$14.99");
  });

  it("rejects a verified compare-at that is not greater than the current price", () => {
    const p = deriveSalePricing("x", 999, {
      compare_at_price_cents: 999,
      compare_at_verified: true,
    });
    expect(p.hasDiscount).toBe(false);
  });
});

describe("storefrontPricing honest-reviews law", () => {
  it("derivePlatformReview never fabricates a rating or count", () => {
    const r = derivePlatformReview("any-id");
    expect(r.available).toBe(false);
    expect(r.average).toBeNull();
    expect(r.count).toBeNull();
  });

  it("deriveEditorialQuality surfaces QC signals, not a star rating", () => {
    const q = deriveEditorialQuality("any-id");
    expect(q.passedQC).toBe(true);
    expect(q.verifiedPdf).toBe(true);
    expect(q.ageChecked).toBe(true);
    expect(q.label).toMatch(/editorial quality/i);
  });
});
