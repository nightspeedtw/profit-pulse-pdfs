// Vitest unit tests for the pricing resolver (Phase 1 guardrails).
import { describe, it, expect } from "vitest";
import {
  resolveFromRow,
  resolveFallback,
  preflightCompareAt,
  MIN_REGULAR_CENTS,
  SINGLE_SALE_FLOOR_CENTS,
  type ProductPricingRow,
} from "./pricing-resolver.ts";

const baseRow = (over: Partial<ProductPricingRow> = {}): ProductPricingRow => ({
  product_kind: "ebook_kids",
  product_id: "00000000-0000-0000-0000-000000000001",
  market: "US",
  regular_price_cents: 999,
  campaign_price_cents: null,
  effective_price_cents: 999,
  active_campaign_id: null,
  campaign_valid_from: null,
  campaign_valid_to: null,
  locked_until: null,
  rule_version: 1,
  ...over,
});

describe("pricing resolver — floors", () => {
  it("clamps regular price to $5.00 minimum", () => {
    const r = resolveFromRow(baseRow({ regular_price_cents: 199 }));
    expect(r.regularCents).toBe(MIN_REGULAR_CENTS);
    expect(r.effectiveCents).toBe(MIN_REGULAR_CENTS);
  });

  it("clamps campaign price to $1.99 single-sale floor", () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const r = resolveFromRow(
      baseRow({
        regular_price_cents: 999,
        campaign_price_cents: 50, // below floor
        active_campaign_id: "cmp",
        campaign_valid_from: "2026-07-01T00:00:00Z",
        campaign_valid_to: "2026-08-01T00:00:00Z",
      }),
      now,
    );
    expect(r.campaignCents).toBe(SINGLE_SALE_FLOOR_CENTS);
    expect(r.effectiveCents).toBe(SINGLE_SALE_FLOOR_CENTS);
  });

  it("ignores expired campaigns and returns regular", () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const r = resolveFromRow(
      baseRow({
        campaign_price_cents: 199,
        active_campaign_id: "cmp",
        campaign_valid_from: "2026-01-01T00:00:00Z",
        campaign_valid_to: "2026-01-02T00:00:00Z",
      }),
      now,
    );
    expect(r.source).toBe("regular");
    expect(r.campaignCents).toBeNull();
    expect(r.effectiveCents).toBe(999);
  });

  it("never elevates campaign price above regular", () => {
    const now = new Date("2026-07-20T12:00:00Z");
    const r = resolveFromRow(
      baseRow({
        regular_price_cents: 999,
        campaign_price_cents: 1500,
        active_campaign_id: "cmp",
        campaign_valid_from: "2026-07-01T00:00:00Z",
        campaign_valid_to: "2026-08-01T00:00:00Z",
      }),
      now,
    );
    expect(r.effectiveCents).toBe(999);
    expect(r.source).toBe("regular");
  });
});

describe("pricing resolver — fallback", () => {
  it("bumps stray fallback prices to floor", () => {
    const r = resolveFallback("ebook_kids", "x", 199);
    expect(r.effectiveCents).toBe(MIN_REGULAR_CENTS);
    expect(r.source).toBe("fallback");
  });
});

describe("preflightCompareAt", () => {
  it("rejects when compare-at is not provided", () => {
    expect(preflightCompareAt({ effectiveCents: 500, compareAtCents: 0, campaignStartAt: "2026-01-01T00:00:00Z" }).legitimate).toBe(false);
  });
  it("rejects when compare-at is not a discount", () => {
    expect(preflightCompareAt({ effectiveCents: 999, compareAtCents: 999, campaignStartAt: "2026-01-01T00:00:00Z" }).legitimate).toBe(false);
  });
  it("rejects when campaign has no start", () => {
    expect(preflightCompareAt({ effectiveCents: 500, compareAtCents: 999, campaignStartAt: null }).legitimate).toBe(false);
  });
  it("rejects future campaign start", () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(preflightCompareAt({ effectiveCents: 500, compareAtCents: 999, campaignStartAt: future }).legitimate).toBe(false);
  });
  it("passes preflight when start is past and compare > effective", () => {
    expect(
      preflightCompareAt({
        effectiveCents: 500,
        compareAtCents: 999,
        campaignStartAt: "2026-01-01T00:00:00Z",
      }).legitimate,
    ).toBe(true);
  });
});
