import { describe, it, expect } from "vitest";
import {
  KIDS_BRAND_ASSETS,
  KIDS_BRAND_LAYOUT,
  computeLogoRect,
  decideBrandingForCorner,
  pageKindAllowsBranding,
} from "@/lib/kidsBranding";

describe("kids-branding policy", () => {
  it("exposes canonical CDN asset URLs for full/footer/mark variants", () => {
    for (const key of ["full", "footer", "mark"] as const) {
      expect(KIDS_BRAND_ASSETS[key]).toMatch(/^\/__l5e\/assets-v1\/[0-9a-f-]{36}\/secretpdf-kids-/);
    }
  });

  it("cover page NEVER carries branding; every other page kind does", () => {
    expect(pageKindAllowsBranding("cover")).toBe(false);
    for (const k of ["title", "copyright", "story", "spot_the_clues", "talk_about_story", "the_end"] as const) {
      expect(pageKindAllowsBranding(k)).toBe(true);
    }
  });

  it("computeLogoRect stays inside the safe frame at the bottom-right", () => {
    const rect = computeLogoRect(612, 612);
    // Sits at the bottom-right corner, respects safe margin.
    expect(rect.x + rect.w).toBeCloseTo(612 - KIDS_BRAND_LAYOUT.safe_margin_pt, 1);
    expect(rect.y).toBe(KIDS_BRAND_LAYOUT.safe_margin_pt);
    // Width is 12–14% of page width (owner spec) with min 72pt floor.
    expect(rect.w).toBeGreaterThanOrEqual(72);
    expect(rect.w / 612).toBeGreaterThanOrEqual(0.12);
    expect(rect.w / 612).toBeLessThanOrEqual(0.14);
    // Preserves aspect (1832×505 footer).
    expect(rect.w / rect.h).toBeCloseTo(1832 / 505, 2);
  });

  describe("decideBrandingForCorner heuristic", () => {
    it("stamps both on a normal mid-tone corner", () => {
      const d = decideBrandingForCorner({ mean: 160, variance: 800 });
      expect(d).toEqual({ logo: true, copyright: true, reason: null });
    });

    it("skips the logo when the corner is too dark (climax spread)", () => {
      const d = decideBrandingForCorner({ mean: 22, variance: 400 });
      expect(d.logo).toBe(false);
      expect(d.copyright).toBe(true);
      expect(d.reason).toBe("corner_too_dark");
    });

    it("skips the logo when the corner is too busy (dense art)", () => {
      const d = decideBrandingForCorner({ mean: 140, variance: 4200 });
      expect(d.logo).toBe(false);
      expect(d.reason).toBe("corner_too_busy");
    });

    it("skips the logo when the corner is nearly pure white", () => {
      const d = decideBrandingForCorner({ mean: 250, variance: 40 });
      expect(d.logo).toBe(false);
      expect(d.reason).toBe("corner_too_bright");
    });

    it("only suppresses the copyright line on catastrophic dark+noisy corners", () => {
      const d = decideBrandingForCorner({ mean: 10, variance: 3000 });
      expect(d.logo).toBe(false);
      expect(d.copyright).toBe(false);
    });
  });
});
