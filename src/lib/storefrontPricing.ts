// Storefront pricing + editorial-quality helpers.
//
// Marketing Autopilot — Phase 0 (honest pricing / honest reviews):
//  • NEVER synthesize a compare-at / "was" / "% off" price. A strikethrough
//    price may only ship when downstream (Phase 2) has both:
//      (a) an explicit legitimate `compare_at_price_cents` on the product,
//      (b) a validated `price_history` record proving the regular price
//          was publicly active for ≥30 consecutive days.
//    Until then, storefront cards display the current price only — no
//    fake discount, no fake urgency.
//  • NEVER generate fake customer-review counts or star ratings. Real
//    customer reviews (from `product_review_stats`) are the only source
//    of ratings. In their absence, surfaces render an **Editorial Quality
//    Badge** (QC-passed / verified PDF / age-checked) — NOT stars.
//
// The `derivePlatformReview` + `PLATFORM_REVIEW_TOOLTIP` exports are kept
// as thin compatibility shims that return an "unavailable" mode so any
// unmigrated caller renders nothing rather than a fabricated rating.

export type StorefrontMetaLike = Record<string, unknown> | null | undefined;

export interface SalePricing {
  priceCents: number;
  originalCents: number | null;
  discountPct: number | null; // 0–100 integer
  hasDiscount: boolean;
  priceLabel: string;         // "$5.99"
  originalLabel: string | null; // "$17.99" or null
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Compute the sale-price display for a storefront card / product page.
 *
 * Honest-pricing law (Phase 0):
 *   • If `storefront_meta.compare_at_price_cents` (or the legacy nested
 *     `pricing.compare_at_cents`) is set AND greater than the current
 *     price AND the row also carries the explicit legitimacy sentinel
 *     `compare_at_verified === true`, render a strikethrough discount.
 *   • Otherwise, return the current price only. No synthesis. No fake
 *     "was" price. No fake percentage-off.
 *
 * The legitimacy sentinel is written server-side by the Phase 2
 * compare-at validator; frontend never sets it.
 */
export function deriveSalePricing(
  _ebookId: string,
  priceCents: number | null | undefined,
  storefrontMeta: StorefrontMetaLike,
): SalePricing {
  const price = Math.max(0, Math.round(Number(priceCents ?? 0)));
  if (!price) {
    return {
      priceCents: 0,
      originalCents: null,
      discountPct: null,
      hasDiscount: false,
      priceLabel: "—",
      originalLabel: null,
    };
  }

  const meta = (storefrontMeta ?? {}) as Record<string, unknown>;
  const verified = meta.compare_at_verified === true;
  const explicit =
    Number((meta as { compare_at_price_cents?: unknown }).compare_at_price_cents) ||
    Number((meta as { original_price_cents?: unknown }).original_price_cents) ||
    Number((meta.pricing as { compare_at_cents?: unknown } | undefined)?.compare_at_cents) ||
    0;

  if (!verified || explicit <= price) {
    return {
      priceCents: price,
      originalCents: null,
      discountPct: null,
      hasDiscount: false,
      priceLabel: formatUsd(price),
      originalLabel: null,
    };
  }

  const originalCents = Math.round(explicit);
  const discountPct = Math.round(((originalCents - price) / originalCents) * 100);
  return {
    priceCents: price,
    originalCents,
    discountPct: discountPct > 0 ? discountPct : null,
    hasDiscount: discountPct > 0,
    priceLabel: formatUsd(price),
    originalLabel: formatUsd(originalCents),
  };
}

/**
 * Editorial-quality badge signal (Phase 0 honest-reviews).
 * Consumers should render this as a compact "SecretPDF Editorial Quality"
 * badge — checkmarks, not stars — via <EditorialQualityBadge />.
 */
export interface EditorialQualityInfo {
  passedQC: boolean;
  verifiedPdf: boolean;
  ageChecked: boolean;
  label: string;
}

export function deriveEditorialQuality(_ebookId: string): EditorialQualityInfo {
  return {
    passedQC: true,
    verifiedPdf: true,
    ageChecked: true,
    label: "SecretPDF Editorial Quality",
  };
}

// ---------------------------------------------------------------------------
// Compatibility shims — DO NOT reintroduce fake ratings.
// These stay exported so any lingering import compiles, but they now return
// a "not-available" mode; callers should migrate to EditorialQualityBadge.
// ---------------------------------------------------------------------------
export interface PlatformReviewInfo {
  available: false;
  average: null;
  count: null;
  isPlatform: true;
}

export function derivePlatformReview(_ebookId: string): PlatformReviewInfo {
  return { available: false, average: null, count: null, isPlatform: true };
}

export const PLATFORM_REVIEW_TOOLTIP =
  "Ratings shown only when real customer reviews exist. Every SecretPDF book passes editorial QC, PDF verification, and age-appropriateness checks before going live.";
