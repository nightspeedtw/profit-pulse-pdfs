// OWNER LAW 'cover_can_never_fail' — release-blocking rendered proof for
// the deterministic self-art cover rung. If this fails, the coloring
// pipeline is one flaky Fal call away from shipping a blank cover.
//
// Guarantees under test:
//   1. Flood-fill colorization actually fills enclosed white regions with
//      palette colors (not left blank, not white-washed).
//   2. Non-background regions receive DIFFERENT colors than the background
//      — so the composed art has real color variance, never a solid tint.
//   3. Line art (dark pixels below the fillable threshold) is preserved.
//   4. Region ranking is deterministic: largest region = background palette
//      color; smaller regions cycle the subject palette.
//   5. Palette lookup returns per-category palettes and falls back safely
//      for unknown category keys.
//
// The compose step (renderColoringSelfArtCover) is exercised via its pure
// core (colorizeLineArt) because it does not require imagescript's fetch/
// resize chain to prove the invariants. The compose call is smoke-tested
// separately in edge-function integration.

import { describe, it, expect } from "vitest";
import {
  colorizeLineArt,
  SELF_ART_COVER_VERSION,
} from "../../supabase/functions/_shared/coloring/self-art-cover.ts";
import {
  paletteForCategory,
  COLORING_CATEGORY_PALETTES,
  COLORING_DEFAULT_PALETTE,
  rgb24ToRgba32,
} from "../../supabase/functions/_shared/coloring/coloring-palettes.ts";

/** Build a small synthetic "line art" raster with an outer white region
 *  (the background), a black rectangular border acting as line art, and a
 *  smaller enclosed white region inside — the classic two-region topology
 *  a real coloring page has for every subject. */
function buildFixtureRgba(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = 255;
    }
  }
  // Black rectangle border — line art enclosing a smaller region.
  const bx0 = Math.floor(width * 0.3), bx1 = Math.floor(width * 0.7);
  const by0 = Math.floor(height * 0.3), by1 = Math.floor(height * 0.7);
  const drawBlack = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 255;
  };
  for (let x = bx0; x <= bx1; x++) { drawBlack(x, by0); drawBlack(x, by1); }
  for (let y = by0; y <= by1; y++) { drawBlack(bx0, y); drawBlack(bx1, y); }
  return rgba;
}

describe("cover_can_never_fail: palette catalog", () => {
  it("covers every live coloring category by key", () => {
    for (const key of [
      "farm_and_woodland", "sea_animals", "mermaid_ocean_fantasy",
      "preschool_toddler", "dinosaurs", "cute_animals",
    ]) {
      expect(COLORING_CATEGORY_PALETTES[key]).toBeDefined();
      expect(COLORING_CATEGORY_PALETTES[key].subjects.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("falls back to warm default palette for unknown keys", () => {
    const p = paletteForCategory("does_not_exist_xyz");
    expect(p).toBe(COLORING_DEFAULT_PALETTE);
    expect(p.subjects.length).toBeGreaterThanOrEqual(4);
  });

  it("rgb24ToRgba32 packs bytes with full alpha", () => {
    const packed = rgb24ToRgba32(0x123456);
    expect(packed).toBe(0x123456FF >>> 0);
  });
});

describe("cover_can_never_fail: flood-fill colorization contract", () => {
  const W = 60, H = 60;
  const fixture = buildFixtureRgba(W, H);
  const palette = paletteForCategory("farm_and_woodland");
  const { rgba, evidence } = colorizeLineArt(fixture, W, H, palette);

  it("returns evidence with at least 2 filled regions (outer + inner)", () => {
    expect(evidence.regions_filled).toBeGreaterThanOrEqual(2);
    expect(evidence.largest_region_pixels).toBeGreaterThan(0);
    expect(evidence.colors_used_hex.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves black line pixels (border stays dark)", () => {
    const bx0 = Math.floor(W * 0.3), by0 = Math.floor(H * 0.3);
    const i = (by0 * W + bx0) * 4;
    expect(rgba[i]).toBeLessThan(60);
    expect(rgba[i + 1]).toBeLessThan(60);
    expect(rgba[i + 2]).toBeLessThan(60);
  });

  it("paints the outer/background region with the palette background color", () => {
    // Sample a corner pixel that was white and is well outside the border.
    const i = (2 * W + 2) * 4;
    const expectedR = (palette.background >> 16) & 0xFF;
    const expectedG = (palette.background >> 8) & 0xFF;
    const expectedB = palette.background & 0xFF;
    expect(rgba[i]).toBe(expectedR);
    expect(rgba[i + 1]).toBe(expectedG);
    expect(rgba[i + 2]).toBe(expectedB);
  });

  it("paints the enclosed inner region with a SUBJECT color, distinct from background", () => {
    // Center pixel of the inner enclosed area.
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const i = (cy * W + cx) * 4;
    const gotR = rgba[i], gotG = rgba[i + 1], gotB = rgba[i + 2];
    const bgR = (palette.background >> 16) & 0xFF;
    const bgG = (palette.background >> 8) & 0xFF;
    const bgB = palette.background & 0xFF;
    const differentFromBg = gotR !== bgR || gotG !== bgG || gotB !== bgB;
    expect(differentFromBg).toBe(true);
    // And matches one of the palette subject colors.
    const matches = palette.subjects.some((c) =>
      gotR === ((c >> 16) & 0xFF) && gotG === ((c >> 8) & 0xFF) && gotB === (c & 0xFF));
    expect(matches).toBe(true);
  });

  it("produces color variance across the raster (not a solid tint)", () => {
    const colorsSeen = new Set<number>();
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const i = (y * W + x) * 4;
        colorsSeen.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
      }
    }
    // At least background + one subject + line-art black.
    expect(colorsSeen.size).toBeGreaterThanOrEqual(3);
  });
});

describe("cover_can_never_fail: version stamp", () => {
  it("bumps its own version tag when the flood-fill algorithm changes", () => {
    // Freezes the current version so a future silent algorithm change forces
    // a matching version bump, which in turn invalidates cached covers.
    expect(SELF_ART_COVER_VERSION).toBe("coloring_self_art_cover_v1");
  });
});
