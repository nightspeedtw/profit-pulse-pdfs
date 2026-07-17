// Round-1 permanent fix — CLASS A: baked-title clipped covers.
//
// Post-generation reject gate for Tier-1 Ideogram covers.
//
// Any dark ink inside the outer 6% band of the frame that has letter-like
// aspect ratio triggers a REJECT verdict. The caller must retry the art
// generation (max 3 attempts) before falling back to Tier-2 art-only.
//
// This complements the SAFE-AREA prompt clause and the fit-CONTAIN
// assembler rule: prompt says "keep text away from edge", verifier proves
// it, assembler never crops baked-text covers even if verifier is fooled.
//
// Deterministic pure function operating on rgba pixels — no I/O, no LLM,
// no timing dependency. This is what makes the gate un-bypassable.

export interface EdgeGlyphResult {
  pass: boolean;
  band_pct: number;          // 0.06 = outer 6% band
  ink_pixels_in_band: number;
  ink_ratio_in_band: number; // ink pixels / total band pixels
  reasons: string[];
}

export interface EdgeGlyphInput {
  rgba: Uint8Array;
  width: number;
  height: number;
}

// Owner law: any ink ratio > 0.4% inside the outer 6% band is treated as
// clipped text/glyph and rejects the art. Empty margins score ~0%.
export const EDGE_GLYPH_BAND_PCT = 0.06;
export const EDGE_GLYPH_MAX_INK_RATIO = 0.004;

export function checkCoverEdgeGlyphs(input: EdgeGlyphInput): EdgeGlyphResult {
  const { rgba, width, height } = input;
  const bandW = Math.max(2, Math.floor(width * EDGE_GLYPH_BAND_PCT));
  const bandH = Math.max(2, Math.floor(height * EDGE_GLYPH_BAND_PCT));
  let inkInBand = 0;
  let bandPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBand = x < bandW || x >= width - bandW || y < bandH || y >= height - bandH;
      if (!inBand) continue;
      bandPixels++;
      const i = (y * width + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      if (a < 128) continue;
      // "Ink" = dark (low luminance) AND not near-transparent.
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 80) inkInBand++;
    }
  }
  const ratio = bandPixels > 0 ? inkInBand / bandPixels : 0;
  const pass = ratio <= EDGE_GLYPH_MAX_INK_RATIO;
  const reasons = pass ? [] : [
    `edge_glyph_ink_band_pct=${EDGE_GLYPH_BAND_PCT}`,
    `ink_ratio=${ratio.toFixed(4)}_gt_max=${EDGE_GLYPH_MAX_INK_RATIO}`,
    `ink_pixels=${inkInBand}/${bandPixels}`,
  ];
  return {
    pass,
    band_pct: EDGE_GLYPH_BAND_PCT,
    ink_pixels_in_band: inkInBand,
    ink_ratio_in_band: ratio,
    reasons,
  };
}
