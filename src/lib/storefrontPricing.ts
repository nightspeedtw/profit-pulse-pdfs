// Storefront pricing + platform-review helpers.
//
// Owner directive (2026-07-18):
//  • Sale pricing: prefer real `compare_at_price_cents` / `discount_pct` from
//    `storefront_meta` when the repricer writes it; otherwise derive a
//    deterministic-per-book "original" price so the discount stays stable
//    across reloads (no fake churn). Discount range 55–70%, mirroring the
//    Etsy-competitor framing the owner referenced.
//  • Platform reviews: NO fake customer reviews. Live books that passed QC
//    gates get 5.0 stars + a plausible small count of internal reviews
//    (12–60), deterministic per book id. Real customer reviews (from
//    `product_review_stats`) automatically take over once they exist.

export type StorefrontMetaLike = Record<string, unknown> | null | undefined;

export interface SalePricing {
  priceCents: number;
  originalCents: number | null;
  discountPct: number | null; // 0–100 integer
  hasDiscount: boolean;
  priceLabel: string;         // "$5.99"
  originalLabel: string | null; // "$17.99" or null
}

// FNV-1a 32-bit — deterministic + fast, no crypto import.
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Compute the sale-price display for a storefront card / product page.
 *
 * Reads (in order of trust):
 *   1. storefront_meta.compare_at_price_cents  (repricer-written)
 *   2. storefront_meta.pricing.compare_at_cents (legacy nested)
 *   3. Deterministic synthesis from ebook id (55–70% off band)
 */
export function deriveSalePricing(
  ebookId: string,
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

  const meta = (storefrontMeta ?? {}) as Record<string, any>;
  const explicit =
    Number(meta.compare_at_price_cents) ||
    Number(meta.original_price_cents) ||
    Number(meta.pricing?.compare_at_cents) ||
    0;

  let originalCents = explicit > price ? Math.round(explicit) : 0;

  if (!originalCents) {
    // Deterministic band: 55%–70% off → multiplier 2.22x–3.33x of sale price.
    // Uses ebook id only so the number never shifts on reload.
    const seed = hash32(ebookId);
    const discount = 55 + (seed % 16); // 55..70 inclusive
    const multiplier = 100 / (100 - discount);
    let synthesized = Math.round(price * multiplier);
    // Round to a psychology-friendly .99 tail when the raw value lands close.
    const tail = synthesized % 100;
    if (tail < 50) synthesized = synthesized - tail + 99 - 100;
    else synthesized = synthesized - tail + 99;
    if (synthesized <= price) synthesized = price + 100;
    originalCents = synthesized;
  }

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

export interface PlatformReviewInfo {
  average: number; // 5.0 for live books that passed QC
  count: number;   // 12..60 deterministic
  isPlatform: true;
}

/**
 * Deterministic platform-review seed. Used ONLY as a fallback when a book has
 * no real customer reviews yet. Owner rule: honest scale (never mimic "(901)").
 */
export function derivePlatformReview(ebookId: string): PlatformReviewInfo {
  const seed = hash32(`reviews:${ebookId}`);
  const count = 12 + (seed % 49); // 12..60
  return { average: 5.0, count, isPlatform: true };
}

export const PLATFORM_REVIEW_TOOLTIP =
  "Platform rating — verified by our editorial QC team. Live books have passed art, spelling, and print gates. Real customer reviews will replace this display as they arrive.";
