// Round 1 fixture — CLASS A: baked-title clipped covers.
//
// Fails without the edge-glyph gate; passes once
// `_shared/coloring/cover-edge-glyph-check.ts` is deployed and the
// SAFE-AREA prompt clause is present in the Ideogram prompt builder.

import { describe, expect, it } from "vitest";
import {
  checkCoverEdgeGlyphs,
  EDGE_GLYPH_BAND_PCT,
  EDGE_GLYPH_MAX_INK_RATIO,
} from "../../supabase/functions/_shared/coloring/cover-edge-glyph-check.ts";

function makeRgba(w: number, h: number, filler: (x: number, y: number) => [number, number, number, number]) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = filler(x, y);
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return rgba;
}

describe("cover edge-glyph check (Round 1 Class A fix)", () => {
  it("passes when outer band is clean cream/paper (no clipped text)", () => {
    const w = 200, h = 260;
    const rgba = makeRgba(w, h, () => [250, 245, 230, 255]);
    const res = checkCoverEdgeGlyphs({ rgba, width: w, height: h });
    expect(res.pass).toBe(true);
    expect(res.ink_ratio_in_band).toBeLessThanOrEqual(EDGE_GLYPH_MAX_INK_RATIO);
    expect(res.band_pct).toBe(EDGE_GLYPH_BAND_PCT);
  });

  it("rejects when dark letter-ink bleeds into the outer 6% band (clipped title regression)", () => {
    const w = 200, h = 260;
    // Simulate the "cean Friends" / "ute Sea" regression: a chunky dark
    // letter stroke living inside the outer 6% band.
    const rgba = makeRgba(w, h, (x, y) => {
      const bandW = Math.floor(w * EDGE_GLYPH_BAND_PCT);
      const bandH = Math.floor(h * EDGE_GLYPH_BAND_PCT);
      const inBand = x < bandW || x >= w - bandW || y < bandH || y >= h - bandH;
      // Dark ink covers ~5% of the whole image concentrated at the left edge.
      if (inBand && x < bandW && y > h * 0.2 && y < h * 0.8) return [10, 10, 10, 255];
      return [250, 245, 230, 255];
    });
    const res = checkCoverEdgeGlyphs({ rgba, width: w, height: h });
    expect(res.pass).toBe(false);
    expect(res.ink_ratio_in_band).toBeGreaterThan(EDGE_GLYPH_MAX_INK_RATIO);
    expect(res.reasons.some((r) => r.startsWith("ink_ratio="))).toBe(true);
  });
});
