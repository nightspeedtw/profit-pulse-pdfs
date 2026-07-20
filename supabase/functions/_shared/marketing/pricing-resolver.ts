// Marketing Autopilot — authoritative server-side pricing resolver.
//
// This is the SINGLE source of truth for the price shown to a US shopper at a
// given moment. Card, PDP, cart, checkout, payment provider, order record,
// receipt, GA4, and Google Ads MUST all round-trip through this resolver so
// the same SKU at the same instant shows the same price to every user.
//
// Contract:
//   • Never synthesizes a compare-at / "was" / "% off" price.
//   • Never trusts a browser-submitted price.
//   • Reads only `product_pricing` (+ future `campaigns`). Falls back to the
//     product row's stored `price_cents` only when no product_pricing row
//     exists yet (transitional), and only above the $5.00 floor.
//   • Enforces the $5.00 regular floor and $1.99 single-item floor.
//
// Pure module — safe for Deno edge functions and Node vitest.

export type ProductKind = "ebook_kids" | "ebook" | "bundle" | "coloring_v2";

export interface ResolvedPrice {
  productKind: ProductKind;
  productId: string;
  market: string;
  currency: "USD";
  regularCents: number;
  campaignCents: number | null;
  effectiveCents: number;
  source: "campaign" | "regular" | "fallback";
  campaignId: string | null;
  campaignValidFrom: string | null;
  campaignValidTo: string | null;
  lockedUntil: string | null;
  ruleVersion: number;
}

export interface ProductPricingRow {
  product_kind: ProductKind;
  product_id: string;
  market: string;
  regular_price_cents: number;
  campaign_price_cents: number | null;
  effective_price_cents: number;
  active_campaign_id: string | null;
  campaign_valid_from: string | null;
  campaign_valid_to: string | null;
  locked_until: string | null;
  rule_version: number;
}

export const MIN_REGULAR_CENTS = 500;
export const SINGLE_SALE_FLOOR_CENTS = 199;
export const BUNDLE_PER_BOOK_FLOOR_CENTS = 199;

/** Deterministic resolver. Takes the row + now(); returns the price to show. */
export function resolveFromRow(
  row: ProductPricingRow,
  now: Date = new Date(),
): ResolvedPrice {
  const regular = Math.max(MIN_REGULAR_CENTS, Math.round(row.regular_price_cents));

  const withinCampaign =
    row.active_campaign_id !== null &&
    row.campaign_price_cents !== null &&
    row.campaign_price_cents > 0 &&
    row.campaign_valid_from !== null &&
    row.campaign_valid_to !== null &&
    new Date(row.campaign_valid_from).getTime() <= now.getTime() &&
    new Date(row.campaign_valid_to).getTime() > now.getTime();

  let effective = regular;
  let source: ResolvedPrice["source"] = "regular";
  let campaignCents: number | null = null;

  if (withinCampaign) {
    const cap = Math.max(SINGLE_SALE_FLOOR_CENTS, Math.round(row.campaign_price_cents!));
    if (cap < regular) {
      effective = cap;
      campaignCents = cap;
      source = "campaign";
    }
  }

  return {
    productKind: row.product_kind,
    productId: row.product_id,
    market: row.market,
    currency: "USD",
    regularCents: regular,
    campaignCents,
    effectiveCents: effective,
    source,
    campaignId: withinCampaign ? row.active_campaign_id : null,
    campaignValidFrom: withinCampaign ? row.campaign_valid_from : null,
    campaignValidTo: withinCampaign ? row.campaign_valid_to : null,
    lockedUntil: row.locked_until,
    ruleVersion: row.rule_version,
  };
}

/** Transitional fallback when no product_pricing row exists. */
export function resolveFallback(
  productKind: ProductKind,
  productId: string,
  rawCents: number | null | undefined,
  market: string = "US",
): ResolvedPrice {
  const cents = Math.max(MIN_REGULAR_CENTS, Math.round(Number(rawCents ?? 0) || 999));
  return {
    productKind,
    productId,
    market,
    currency: "USD",
    regularCents: cents,
    campaignCents: null,
    effectiveCents: cents,
    source: "fallback",
    campaignId: null,
    campaignValidFrom: null,
    campaignValidTo: null,
    lockedUntil: null,
    ruleVersion: 0,
  };
}

/**
 * Compare-at legitimacy check. Frontend must call this via the DB function
 * of the same name; this pure wrapper exists for tests + server code.
 *
 * A compare-at price ("was $X") may render ONLY when:
 *   1. Campaign has a real start timestamp in the past.
 *   2. Compare-at strictly exceeds current effective price.
 *   3. The regular price at `compareAtCents` was publicly active for at
 *      least `minDays` (default 30) consecutive days ending before the
 *      campaign start. The DB function verifies (3) against price_history.
 */
export interface CompareAtCheck {
  legitimate: boolean;
  reason?: string;
}
export function preflightCompareAt(args: {
  effectiveCents: number;
  compareAtCents: number | null | undefined;
  campaignStartAt: string | null | undefined;
}): CompareAtCheck {
  const compare = Number(args.compareAtCents ?? 0);
  if (!compare || compare <= 0) return { legitimate: false, reason: "no_compare_at" };
  if (!args.campaignStartAt) return { legitimate: false, reason: "no_campaign_start" };
  if (new Date(args.campaignStartAt).getTime() > Date.now()) {
    return { legitimate: false, reason: "future_campaign_start" };
  }
  if (compare <= args.effectiveCents) return { legitimate: false, reason: "not_a_discount" };
  return { legitimate: true };
}
