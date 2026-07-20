// Regression: OWNER LAW `no_popups_v5` — the V2 coloring cover overlay must
// NEVER draw chip, banner, ribbon, pill, or age mark. The overlay only renders
// a title in the textless-fallback path; otherwise it draws nothing.
//
// This test guards the *SVG builder* directly so that a future edit that
// reintroduces popup elements fails at build/test time, not in production.

import { describe, it, expect } from "vitest";
import {
  buildOverlaySvg,
  assertOverlaySvgNoPopups,
  COVER_OVERLAY_CONTRACT,
  overlayIsCurrent,
} from "@/lib/coloringCoverOverlaySvg";

const base = { width: 1024, height: 1024, ageBadge: "AGES 4-6" };

describe("no_popups_v5 overlay builder", () => {
  it("exports the current frozen contract", () => {
    expect(COVER_OVERLAY_CONTRACT).toBe("premium_cover_overlay_v5_no_text_ever");
  });

  it("title-only mode produces an empty SVG (no drawing elements)", () => {
    const svg = buildOverlaySvg(base);
    const noComment = svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^?]*\?>/g, "");
    const hasElement = /<(?:path|rect|circle|ellipse|polygon|polyline|line|g|text|tspan|image|foreignObject)[\s>]/i.test(noComment);
    expect(hasElement).toBe(false);
  });

  it("textless-fallback mode draws ONLY the title (no shapes)", () => {
    const svg = buildOverlaySvg({ ...base, fallbackTitle: "My Title" });
    const noComment = svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^?]*\?>/g, "");
    const hasText = /<text[\s>]/i.test(noComment);
    const hasNonText = /<(?:path|rect|circle|ellipse|polygon|polyline|line|g|image|foreignObject)[\s>]/i.test(noComment);
    expect(hasText).toBe(true);
    expect(hasNonText).toBe(false);
  });

  it("legacy inputs (ribbonText, showRibbon, topLabel, subtitle, blurb) are ignored", () => {
    const svg = buildOverlaySvg({
      ...base,
      ribbonText: "SALE",
      showRibbon: true,
      topLabel: "COLORING BOOK",
      subtitle: "Buy now",
      blurb: "Limited time",
    });
    const noComment = svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^?]*\?>/g, "");
    expect(noComment).not.toMatch(/SALE|ribbon|banner|chip|AGES/);
    expect(/<text[\s>]/i.test(noComment)).toBe(false);
  });

  it("assertOverlaySvgNoPopups passes for valid SVGs", () => {
    const svg = buildOverlaySvg(base);
    const svgFallback = buildOverlaySvg({ ...base, fallbackTitle: "My Title" });
    expect(() => assertOverlaySvgNoPopups(svg, svgFallback)).not.toThrow();
  });

  it("assertOverlaySvgNoPopups throws when a popup element is present", () => {
    const badSvg = `<?xml version="1.0"?><svg><rect x="0" y="0" width="100" height="100" fill="#FFD700"/></svg>`;
    const fallback = buildOverlaySvg({ ...base, fallbackTitle: "X" });
    expect(() => assertOverlaySvgNoPopups(badSvg, fallback)).toThrow(/regression/);
  });

  it("overlayIsCurrent requires the frozen contract value", () => {
    expect(overlayIsCurrent({ overlay: COVER_OVERLAY_CONTRACT })).toBe(true);
    expect(overlayIsCurrent({ overlay: "premium_cover_overlay_v3_age_in_chip" })).toBe(false);
    expect(overlayIsCurrent({})).toBe(false);
    expect(overlayIsCurrent(null)).toBe(false);
  });
});
