// Pure geometry for the coloring matter-page brand footer + border.
// Contains no pdf-lib import so it can run in vitest.
//
// OWNER LAW `matter_pages_no_overlap_v1` (2026-07-23):
//   The four decorative layers on every matter page — border ring, corner
//   confetti dots, corner vignettes, and the SecretPDF brand footer
//   (© line + logo) — must live in reserved zones that never intersect.

export const MATTER_LAYOUT = {
  /** Height of the reserved footer band at the bottom of the page. */
  footerBandH: 34,
  /** Padding above the inner-rule when placing the footer baseline. */
  footerBaselinePad: 6,
  /** Max logo height inside the footer band. */
  logoMaxH: 18,
  /** Max logo width as fraction of page width. */
  logoMaxWFrac: 0.22,
  /** Horizontal gap between © text and logo. */
  copyLogoGap: 24,
  /** Y-coordinate that page content must stay ABOVE to avoid the footer. */
  contentMinY: 66,
} as const;

export interface Rect { x: number; y: number; w: number; h: number }

export interface FooterLayout {
  baselineY: number;
  marginX: number;
  copyRect: Rect;
  logoRect: Rect;
  bandTop: number;
}

/**
 * Compute the reserved footer band + logo/© rectangles for a page of
 * width `pageW` given the outer border inset. Logo intrinsic size is
 * needed to compute width; when omitted a default aspect (1832×505,
 * matching the trimmed footer asset) is used.
 */
export function computeFooterLayout(
  pageW: number,
  borderInset: number,
  logoIntrinsic: { w: number; h: number } = { w: 1832, h: 505 },
): FooterLayout {
  const innerRuleY = borderInset + 8;
  const baselineY = innerRuleY + MATTER_LAYOUT.footerBaselinePad;
  const marginX = borderInset + 14;
  const maxLogoH = MATTER_LAYOUT.logoMaxH;
  const maxLogoW = pageW * MATTER_LAYOUT.logoMaxWFrac;
  const scale = Math.min(maxLogoW / logoIntrinsic.w, maxLogoH / logoIntrinsic.h);
  const lw = logoIntrinsic.w * scale;
  const lh = logoIntrinsic.h * scale;
  const logoRect: Rect = {
    x: pageW - marginX - lw,
    y: baselineY,
    w: lw,
    h: lh,
  };
  const copyRightEdge = logoRect.x - MATTER_LAYOUT.copyLogoGap;
  const copyRect: Rect = {
    x: marginX,
    y: baselineY,
    w: Math.max(80, copyRightEdge - marginX),
    h: 10,
  };
  return {
    baselineY,
    marginX,
    copyRect,
    logoRect,
    bandTop: baselineY + Math.max(lh, copyRect.h),
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
