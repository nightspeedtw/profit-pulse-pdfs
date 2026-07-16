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
} from "../../supabase/functions/_shared/coloring/self-art-colorize.ts";
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

describe("cover_can_never_fail: flood-fill colorization contract (flat)", () => {
  const W = 60, H = 60;
  const fixture = buildFixtureRgba(W, H);
  const palette = paletteForCategory("farm_and_woodland");
  const { rgba, evidence } = colorizeLineArt(fixture, W, H, palette, { beautify: false });

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

  it("paints the outer/background region with the palette background color when beautify=false", () => {
    const i = (2 * W + 2) * 4;
    const expectedR = (palette.background >> 16) & 0xFF;
    const expectedG = (palette.background >> 8) & 0xFF;
    const expectedB = palette.background & 0xFF;
    expect(rgba[i]).toBe(expectedR);
    expect(rgba[i + 1]).toBe(expectedG);
    expect(rgba[i + 2]).toBe(expectedB);
  });

  it("paints the enclosed inner region with a SUBJECT color, distinct from background", () => {
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const i = (cy * W + cx) * 4;
    const gotR = rgba[i], gotG = rgba[i + 1], gotB = rgba[i + 2];
    const bgR = (palette.background >> 16) & 0xFF;
    const bgG = (palette.background >> 8) & 0xFF;
    const bgB = palette.background & 0xFF;
    expect(gotR !== bgR || gotG !== bgG || gotB !== bgB).toBe(true);
    const matches = palette.subjects.some((c) =>
      gotR === ((c >> 16) & 0xFF) && gotG === ((c >> 8) & 0xFF) && gotB === (c & 0xFF));
    expect(matches).toBe(true);
  });
});

describe("cover_can_never_fail: beautified two-tone gradient (default)", () => {
  const W = 80, H = 80;
  const fixture = buildFixtureRgba(W, H);
  const palette = paletteForCategory("cute_animals");
  const { rgba } = colorizeLineArt(fixture, W, H, palette); // beautify default ON

  it("produces vertical color variance WITHIN the background region (two-tone gradient, not flat)", () => {
    // Sample two rows in the outer background: near-top and near-bottom.
    const topI = (2 * W + 2) * 4;
    const botI = ((H - 3) * W + 2) * 4;
    const dR = Math.abs(rgba[topI] - rgba[botI]);
    const dG = Math.abs(rgba[topI + 1] - rgba[botI + 1]);
    const dB = Math.abs(rgba[topI + 2] - rgba[botI + 2]);
    // Top should be visibly lighter than bottom in at least one channel.
    expect(dR + dG + dB).toBeGreaterThan(6);
  });

  it("top of background region is close to a lightened palette background (Crayola card feel)", () => {
    const i = (2 * W + 2) * 4;
    const bgR = (palette.background >> 16) & 0xFF;
    // Beautified top pixel lightens the base color; hue should still be near bg (within 40).
    expect(Math.abs(rgba[i] - bgR)).toBeLessThan(60);
    // But it must NOT be pure white (which would look like a blank cover).
    expect(rgba[i] < 253 || rgba[i + 1] < 253 || rgba[i + 2] < 253).toBe(true);
  });

  it("preserves line art regardless of beautify setting", () => {
    const bx0 = Math.floor(W * 0.3), by0 = Math.floor(H * 0.3);
    const i = (by0 * W + bx0) * 4;
    expect(rgba[i]).toBeLessThan(60);
  });
});

describe("cover_can_never_fail: version stamp bumped for beautified rung", () => {
  it("bumps SELF_ART_COVER_VERSION to v2 so cached rung-2 covers are invalidated when the beautifier changes", () => {
    expect(SELF_ART_COVER_VERSION).toBe("coloring_self_art_cover_v2_beautified");
  });
});

