import { describe, it, expect } from "vitest";
import {
  COVER_OVERLAY_CONTRACT,
  overlayIsCurrent,
  buildOverlaySvg,
} from "@/lib/coloringCoverOverlaySvg";

describe("cover_bake_only_v6 — overlay is retired", () => {
  it("contract string is the bake-only sentinel", () => {
    expect(COVER_OVERLAY_CONTRACT).toBe("cover_bake_only_v6_no_overlay_ever");
  });

  it("SVG contains no drawing elements ever", () => {
    const svg = buildOverlaySvg({ width: 1024, height: 1024, ageBadge: "Ages 4-6" });
    const noComment = svg.replace(/<!--[\s\S]*?-->/g, "");
    expect(/<(?:path|rect|circle|ellipse|polygon|polyline|line|text|tspan|image|foreignObject|g)[\s>]/i.test(noComment)).toBe(false);
  });

  it("overlayIsCurrent recognises the sentinel", () => {
    expect(overlayIsCurrent({ overlay: COVER_OVERLAY_CONTRACT })).toBe(true);
    expect(overlayIsCurrent({ overlay: "premium_cover_overlay_v5_no_text_ever" })).toBe(false);
    expect(overlayIsCurrent(null)).toBe(false);
  });
});
