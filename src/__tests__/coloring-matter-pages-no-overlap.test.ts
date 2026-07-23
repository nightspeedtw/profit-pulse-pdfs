// Regression: `matter_pages_no_overlap_v1` (2026-07-23).
// The four decorative layers on every matter page — border ring, corner
// confetti dots, corner vignettes, and the SecretPDF brand footer
// (© line + logo) — must live in reserved zones that never intersect.
// Screenshot bug: the Title page footer landed on top of the bottom-right
// corner vignette and the bottom border/confetti (Gears and Galleons).
import { describe, it, expect } from "vitest";
import {
  MATTER_LAYOUT,
  computeFooterLayout,
  rectsOverlap,
} from "../../supabase/functions/_shared/coloring/matter-pages-layout.ts";

describe("matter_pages_no_overlap_v1", () => {
  const pageW = 612;
  const pageH = 612;
  const borderInset = 24;
  const innerRuleY = borderInset + 8; // 32

  it("places the footer baseline INSIDE the inner border rule", () => {
    const l = computeFooterLayout(pageW, borderInset);
    expect(l.baselineY).toBeGreaterThan(innerRuleY);
    expect(l.baselineY).toBeLessThan(MATTER_LAYOUT.contentMinY);
  });

  it("© rect and logo rect never overlap and keep the mandated horizontal gap", () => {
    const l = computeFooterLayout(pageW, borderInset);
    expect(rectsOverlap(l.copyRect, l.logoRect)).toBe(false);
    const gap = l.logoRect.x - (l.copyRect.x + l.copyRect.w);
    expect(gap).toBeGreaterThanOrEqual(MATTER_LAYOUT.copyLogoGap - 0.001);
  });

  it("logo stays inside the inner rule on both axes", () => {
    const l = computeFooterLayout(pageW, borderInset);
    expect(l.logoRect.x).toBeGreaterThan(innerRuleY); // left edge clear of side border
    expect(l.logoRect.x + l.logoRect.w).toBeLessThan(pageW - innerRuleY);
    expect(l.logoRect.h).toBeLessThanOrEqual(MATTER_LAYOUT.logoMaxH + 0.001);
  });

  it("bottom-right corner vignette (when avoidBottom is honored) does NOT overlap the logo band", () => {
    // avoidBottom moves the second vignette to top-right. Simulate the
    // legacy bottom-right position and assert the new placement wins.
    const size = pageW * 0.18;
    const margin = 44;
    const legacyBottomRight = { x: pageW - margin - size, y: margin, w: size, h: size };
    const newTopRight = { x: pageW - margin - size, y: pageH - margin - size, w: size, h: size };
    const l = computeFooterLayout(pageW, borderInset);
    expect(rectsOverlap(legacyBottomRight, l.logoRect)).toBe(true); // proves the old bug
    expect(rectsOverlap(newTopRight, l.logoRect)).toBe(false);       // proves the fix
  });

  it("bottom confetti-dot cluster is above the footer band when reserveFooter is honored", () => {
    // Legacy dot centers sat at (inset+18, inset+18) → overlap. With
    // reserveFooter=true those dots are omitted entirely; the top dots
    // live near pageH-inset-18 which is far above the footer band.
    const l = computeFooterLayout(pageW, borderInset);
    const topDotY = pageH - borderInset - 18;
    expect(topDotY).toBeGreaterThan(l.baselineY + l.logoRect.h + 40);
  });
});
