// Pure flood-fill colorization for the deterministic self-art cover rung.
//
// OWNER LAW 'cover_can_never_fail' / skill 'coloring_cover_forever'.
//
// This module is deliberately dependency-free (no imagescript, no Deno
// APIs) so it can be unit-tested by vitest under Node without hitting
// remote https:// module loaders. The imagescript raster wrangling lives
// in the sibling `self-art-cover.ts` file, which imports these functions.

import type { ColoringPalette } from "./coloring-palettes.ts";

export const SELF_ART_COVER_VERSION = "coloring_self_art_cover_v2_beautified";

/** Blend two rgb ints toward a lighter tone by t in [0,1]. Used for soft
 *  two-tone region gradients that give the beautified cover a Crayola-like
 *  hand-colored feel instead of flat kindergarten fills. */
export function twoToneShade(baseRgb: number, t: number, lightenBy = 0.22): number {
  const r = (baseRgb >> 16) & 0xff;
  const g = (baseRgb >> 8) & 0xff;
  const b = baseRgb & 0xff;
  const k = 1 + lightenBy * (1 - t); // top of region = lighter, bottom = base
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (clamp(r * (2 - k) + 255 * (k - 1)) << 16)
       | (clamp(g * (2 - k) + 255 * (k - 1)) << 8)
       |  clamp(b * (2 - k) + 255 * (k - 1));
}

const FILLABLE_LUM_MIN = 210;
const MIN_REGION_PIXELS = 40;
const MAX_REGIONS_COLORED = 48;

function hex6(n: number): string {
  return "#" + (n & 0xFFFFFF).toString(16).padStart(6, "0").toUpperCase();
}

function luminanceOfRgba(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export interface ColorizeEvidence {
  working_width: number;
  working_height: number;
  regions_filled: number;
  largest_region_pixels: number;
  colors_used_hex: string[];
}

export interface ColorizeOptions {
  /** Two-tone gradient per region for a hand-colored Crayola feel. */
  beautify?: boolean;
}

export function colorizeLineArt(
  srcRgba: Uint8Array,
  width: number,
  height: number,
  palette: ColoringPalette,
  opts: ColorizeOptions = {},
): { rgba: Uint8Array; evidence: ColorizeEvidence } {
  const beautify = opts.beautify !== false; // default ON
  const n = width * height;
  const label = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = srcRgba[i * 4];
    const g = srcRgba[i * 4 + 1];
    const b = srcRgba[i * 4 + 2];
    label[i] = luminanceOfRgba(r, g, b) >= FILLABLE_LUM_MIN ? 1 : 0;
  }

  const components: number[] = [];
  const yMin: number[] = [];
  const yMax: number[] = [];
  const stack: number[] = [];
  let nextId = 2;

  for (let seed = 0; seed < n; seed++) {
    if (label[seed] !== 1) continue;
    const compId = nextId++;
    let count = 0;
    let ymin = height, ymax = 0;
    stack.push(seed);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (label[idx] !== 1) continue;
      const yy = (idx / width) | 0;
      let xLeft = idx - yy * width;
      let xRight = xLeft;
      while (xLeft > 0 && label[yy * width + (xLeft - 1)] === 1) xLeft--;
      while (xRight < width - 1 && label[yy * width + (xRight + 1)] === 1) xRight++;
      for (let x = xLeft; x <= xRight; x++) {
        const p = yy * width + x;
        label[p] = compId;
        count++;
        if (yy < ymin) ymin = yy;
        if (yy > ymax) ymax = yy;
        if (yy > 0) {
          const pu = p - width;
          if (label[pu] === 1) stack.push(pu);
        }
        if (yy < height - 1) {
          const pd = p + width;
          if (label[pd] === 1) stack.push(pd);
        }
      }
    }
    components[compId] = count;
    yMin[compId] = ymin;
    yMax[compId] = ymax;
  }

  const ranked: { id: number; count: number }[] = [];
  for (let id = 2; id < nextId; id++) {
    const c = components[id] ?? 0;
    if (c >= MIN_REGION_PIXELS) ranked.push({ id, count: c });
  }
  ranked.sort((a, b) => b.count - a.count);
  const cap = Math.min(ranked.length, MAX_REGIONS_COLORED);
  const colorByComp = new Map<number, number>();
  const colorsUsed = new Set<number>();
  for (let i = 0; i < cap; i++) {
    const color = i === 0
      ? palette.background
      : palette.subjects[(i - 1) % palette.subjects.length];
    colorByComp.set(ranked[i].id, color);
    colorsUsed.add(color);
  }

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const lbl = label[i];
    if (lbl <= 1) {
      out[i * 4] = srcRgba[i * 4];
      out[i * 4 + 1] = srcRgba[i * 4 + 1];
      out[i * 4 + 2] = srcRgba[i * 4 + 2];
      out[i * 4 + 3] = 255;
    } else {
      const c = colorByComp.get(lbl);
      if (c == null) {
        out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = 255;
      } else {
        let shaded = c;
        if (beautify) {
          const y = (i / width) | 0;
          const y0 = yMin[lbl] ?? 0;
          const y1 = yMax[lbl] ?? 0;
          const span = Math.max(1, y1 - y0);
          const t = (y - y0) / span; // 0 at top of region, 1 at bottom
          shaded = twoToneShade(c, t);
        }
        out[i * 4] = (shaded >> 16) & 0xFF;
        out[i * 4 + 1] = (shaded >> 8) & 0xFF;
        out[i * 4 + 2] = shaded & 0xFF;
        out[i * 4 + 3] = 255;
      }
    }
  }

  return {
    rgba: out,
    evidence: {
      working_width: width,
      working_height: height,
      regions_filled: cap,
      largest_region_pixels: ranked[0]?.count ?? 0,
      colors_used_hex: [...colorsUsed].map(hex6),
    },
  };
}

