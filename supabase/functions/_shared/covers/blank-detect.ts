// Pure blank-region detector for cover raw art.
//
// Owner defect (3rd occurrence): the coloring cover shipped as a gray
// gradient with typography on top and the bottom 60% empty — the
// "synthetic blank fallback" signature. The prior colorEvidence only
// measured GLOBAL saturation and chroma means, which a mostly-blank
// image with a faint top gradient can still satisfy. This module
// exposes a deterministic per-region variance/chroma measurement so
// the same defect class can never ship again.
//
// Input contract: `rgba` is a length-4*w*h Uint8Array in RGBA order
// (identical to imagescript.getPixelAt bytes packed high→low). The
// caller is responsible for decoding; this module has no runtime deps.

export interface BlankRegionStat {
  band: "top" | "middle" | "bottom";
  pixels: number;
  luminance_mean: number;
  luminance_stdev: number;
  avg_chroma: number;
  blank: boolean;
}

export interface BlankRegionEvidence {
  region_stats: BlankRegionStat[];
  blank_background: boolean;
  blank_ratio: number;
}

export interface BlankThresholds {
  /** Region stdev must be < this to be considered flat. Default 4/255. */
  max_stdev?: number;
  /** Region avg chroma must be < this to be considered neutral. Default 4/255. */
  max_chroma?: number;
}

/**
 * Split the sampled image into vertical thirds and flag any band whose
 * luminance stdev AND chroma are below a printable-art floor.
 *
 * Owner law: any two-of-three empty bands OR (middle + bottom) empty ==
 * shipped fallback → blank_background=true.
 */
export function detectBlankRegions(
  rgba: Uint8Array,
  width: number,
  height: number,
  thresholds: BlankThresholds = {},
): BlankRegionEvidence {
  const maxStdev = thresholds.max_stdev ?? 4;
  const maxChroma = thresholds.max_chroma ?? 4;
  const bins = [
    { band: "top" as const,    yStart: 0, yEnd: Math.floor(height / 3),           n: 0, lumSum: 0, lumSq: 0, chromaSum: 0 },
    { band: "middle" as const, yStart: Math.floor(height / 3), yEnd: Math.floor((2 * height) / 3), n: 0, lumSum: 0, lumSq: 0, chromaSum: 0 },
    { band: "bottom" as const, yStart: Math.floor((2 * height) / 3), yEnd: height, n: 0, lumSum: 0, lumSq: 0, chromaSum: 0 },
  ];
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const chroma = max - min;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      for (const bin of bins) {
        if (y >= bin.yStart && y < bin.yEnd) {
          bin.n += 1;
          bin.lumSum += lum;
          bin.lumSq += lum * lum;
          bin.chromaSum += chroma;
          break;
        }
      }
    }
  }
  const region_stats: BlankRegionStat[] = bins.map((bin) => {
    const n = Math.max(1, bin.n);
    const mean = bin.lumSum / n;
    const variance = bin.lumSq / n - mean * mean;
    const stdev = Math.sqrt(Math.max(0, variance));
    const avgChroma = bin.chromaSum / n;
    return {
      band: bin.band,
      pixels: n,
      luminance_mean: Number(mean.toFixed(2)),
      luminance_stdev: Number(stdev.toFixed(2)),
      avg_chroma: Number(avgChroma.toFixed(2)),
      blank: stdev < maxStdev && avgChroma < maxChroma,
    };
  });
  const blankBands = region_stats.filter((r) => r.blank).length;
  const middle = region_stats.find((r) => r.band === "middle")!;
  const bottom = region_stats.find((r) => r.band === "bottom")!;
  const blank_background = blankBands >= 2 || (middle.blank && bottom.blank);
  return {
    region_stats,
    blank_background,
    blank_ratio: Number((blankBands / 3).toFixed(3)),
  };
}
