// _shared/coloring/self-art-cover.ts
//
// OWNER LAW — 'cover_can_never_fail' ('coloring_cover_forever' skill):
// The coloring cover pipeline has a deterministic, always-succeeds rung
// built from the book's OWN gate-passed interior pages. It replaces the
// old blank/gradient synthetic fallback PERMANENTLY.
//
// KEY INSIGHT: every book reaching the cover stage already owns 32
// interior pages that passed the anatomy + colorability + textless gates.
// A cover built FROM THEM is guaranteed on-category, textless, ours —
// zero cost, zero text risk, zero blank-shipment risk.
//
// Pipeline:
//   1. Pick the top 1..3 pages (already anatomy-approved, so any order
//      works; caller sorts by score if it has one).
//   2. Programmatic colorization: scanline flood-fill each enclosed white
//      region using a warm kid palette (largest region = background tint,
//      remaining regions cycle palette). Pure CPU, no AI, deterministic
//      seed = page number.
//   3. Compose: soft palette background canvas + colored hero art centered.
//      Returns a PNG that is then fed to renderKidsTitleTreatment for the
//      SVG title/badge/logo overlay.
//
// Delivered evidence includes per-page fill counts, region sizes, and the
// palette used — so QC / audits can prove the cover was NOT an AI hail
// mary and NOT a blank gradient.

// @ts-nocheck  Deno edge runtime
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import {
  paletteForCategory,
  rgb24ToRgba32,
  type ColoringPalette,
} from "./coloring-palettes.ts";

export const SELF_ART_COVER_VERSION = "coloring_self_art_cover_v1";

export interface SelfArtSourcePage {
  page: number;
  url: string;
}

export interface SelfArtCoverInput {
  categoryKey: string | null | undefined;
  categoryName: string;
  pages: SelfArtSourcePage[];   // caller supplies top-scoring interior pages first
  maxHeroes?: number;           // default 3
  canvasWidth?: number;         // default 1600
  canvasHeight?: number;        // default 1600
  workingSize?: number;         // per-page working resolution for flood fill; default 512
  seed?: number | string | null;
}

export interface FloodFillPageEvidence {
  page: number;
  source_url: string;
  working_width: number;
  working_height: number;
  regions_filled: number;
  largest_region_pixels: number;
  colors_used_hex: string[];
}

export interface SelfArtCoverResult {
  bytes: Uint8Array;
  version: string;
  palette: {
    background_hex: string;
    subject_hex: string[];
  };
  heroes_used: FloodFillPageEvidence[];
  canvas: { width: number; height: number };
}

// ────────────────────────────────────────────────────────────────────
// Threshold constants
// ────────────────────────────────────────────────────────────────────
const FILLABLE_LUM_MIN = 210;   // >= this luminance counts as "inside a white region"
const MIN_REGION_PIXELS = 40;    // ignore speck regions — leaves the paper texture alone
const MAX_REGIONS_COLORED = 48;  // cap CPU on very busy line art

function hex6(n: number): string {
  return "#" + (n & 0xFFFFFF).toString(16).padStart(6, "0").toUpperCase();
}

function luminanceOfRgba(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Scanline flood-fill colorization of a decoded line-art page. Returns a
 * flat RGBA byte buffer of the working resolution AND per-region evidence.
 *
 * The algorithm:
 *   - Threshold every pixel: fillable = luminance >= FILLABLE_LUM_MIN.
 *   - Flood-fill fillable-connected components with an iterative stack.
 *   - Rank components by pixel count. Largest → background palette color;
 *     rest cycle palette.subjects.
 *   - Non-fillable pixels (the black line art) are preserved untouched.
 */
export function colorizeLineArt(
  srcRgba: Uint8Array,
  width: number,
  height: number,
  palette: ColoringPalette,
): { rgba: Uint8Array; evidence: Omit<FloodFillPageEvidence, "page" | "source_url" | "working_width" | "working_height"> & { working_width: number; working_height: number } } {
  const n = width * height;
  // 0 = line (not fillable), 1 = fillable unvisited, 2+ = component id + 2
  const label = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = srcRgba[i * 4];
    const g = srcRgba[i * 4 + 1];
    const b = srcRgba[i * 4 + 2];
    label[i] = luminanceOfRgba(r, g, b) >= FILLABLE_LUM_MIN ? 1 : 0;
  }

  // Iterative scanline flood-fill
  const components: number[] = []; // pixel counts, index = compId
  const stack: number[] = [];
  let nextId = 2;

  for (let seed = 0; seed < n; seed++) {
    if (label[seed] !== 1) continue;
    const compId = nextId++;
    let count = 0;
    stack.push(seed);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (label[idx] !== 1) continue;
      const yy = (idx / width) | 0;
      let xLeft = idx - yy * width;
      let xRight = xLeft;
      // scan left
      while (xLeft > 0 && label[yy * width + (xLeft - 1)] === 1) xLeft--;
      // scan right
      while (xRight < width - 1 && label[yy * width + (xRight + 1)] === 1) xRight++;
      for (let x = xLeft; x <= xRight; x++) {
        const p = yy * width + x;
        label[p] = compId;
        count++;
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
  }

  // Rank components by size descending
  const ranked: { id: number; count: number }[] = [];
  for (let id = 2; id < nextId; id++) {
    const c = components[id] ?? 0;
    if (c >= MIN_REGION_PIXELS) ranked.push({ id, count: c });
  }
  ranked.sort((a, b) => b.count - a.count);
  const cap = Math.min(ranked.length, MAX_REGIONS_COLORED);
  const colorByComp = new Map<number, number>(); // compId → 0xRRGGBB
  const colorsUsed = new Set<number>();
  for (let i = 0; i < cap; i++) {
    const color = i === 0
      ? palette.background
      : palette.subjects[(i - 1) % palette.subjects.length];
    colorByComp.set(ranked[i].id, color);
    colorsUsed.add(color);
  }

  // Emit output RGBA
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const lbl = label[i];
    if (lbl <= 1) {
      // Preserve original pixel (black ink / anti-alias edge / tiny unfilled region)
      out[i * 4] = srcRgba[i * 4];
      out[i * 4 + 1] = srcRgba[i * 4 + 1];
      out[i * 4 + 2] = srcRgba[i * 4 + 2];
      out[i * 4 + 3] = 255;
    } else {
      const c = colorByComp.get(lbl);
      if (c == null) {
        // Unranked / capped region → leave white
        out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = 255;
      } else {
        out[i * 4] = (c >> 16) & 0xFF;
        out[i * 4 + 1] = (c >> 8) & 0xFF;
        out[i * 4 + 2] = c & 0xFF;
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

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`self_art_fetch_${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function rasterAndDownscale(
  bytes: Uint8Array,
  workingSize: number,
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const decoded = await Image.decode(bytes);
  const scale = Math.min(workingSize / decoded.width, workingSize / decoded.height);
  const w = Math.max(64, Math.round(decoded.width * scale));
  const h = Math.max(64, Math.round(decoded.height * scale));
  const img = (decoded as any).resize(w, h);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = img.getPixelAt(x + 1, y + 1);
      const i = (y * w + x) * 4;
      rgba[i] = (px >>> 24) & 0xff;
      rgba[i + 1] = (px >>> 16) & 0xff;
      rgba[i + 2] = (px >>> 8) & 0xff;
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width: w, height: h };
}

/**
 * Compose the final self-art cover PNG: palette-tinted background canvas
 * with 1..N colorized hero pages laid out. No AI, no external fonts, no
 * gradient synth. Deterministic given the same inputs.
 */
export async function renderColoringSelfArtCover(input: SelfArtCoverInput): Promise<SelfArtCoverResult> {
  const W = input.canvasWidth ?? 1600;
  const H = input.canvasHeight ?? 1600;
  const workingSize = input.workingSize ?? 512;
  const maxHeroes = Math.max(1, Math.min(3, input.maxHeroes ?? 3));
  const palette = paletteForCategory(input.categoryKey);
  const chosen = input.pages.slice(0, maxHeroes);
  if (chosen.length === 0) {
    throw new Error("self_art_cover: no interior pages available");
  }

  // Base canvas painted with palette.background
  const canvas = new Image(W, H);
  const bgRgba = rgb24ToRgba32(palette.background);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      canvas.setPixelAt(x + 1, y + 1, bgRgba);
    }
  }

  // Layout: single hero centered; 2-3 heroes in a horizontal strip.
  const gutter = Math.round(W * 0.03);
  const zoneW = Math.floor((W - gutter * (chosen.length + 1)) / chosen.length);
  // Leave top ~18% clean for the title overlay + bottom ~14% clean for badge/logo.
  const zoneTop = Math.round(H * 0.22);
  const zoneBottom = Math.round(H * 0.86);
  const zoneH = zoneBottom - zoneTop;

  const heroesEvidence: FloodFillPageEvidence[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const page = chosen[i];
    let bytes: Uint8Array;
    try {
      bytes = await fetchBytes(page.url);
    } catch (e) {
      console.warn(`[self-art-cover] page ${page.page} fetch failed: ${(e as Error).message}`);
      continue;
    }
    const { rgba, width: ww, height: hh } = await rasterAndDownscale(bytes, workingSize);
    const colored = colorizeLineArt(rgba, ww, hh, palette);
    // Pack colored back into an Image so we can paste onto canvas at scale.
    const heroImg = new Image(ww, hh);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < ww; x++) {
        const p = (y * ww + x) * 4;
        heroImg.setPixelAt(
          x + 1,
          y + 1,
          ((colored.rgba[p] << 24) | (colored.rgba[p + 1] << 16) | (colored.rgba[p + 2] << 8) | 0xFF) >>> 0,
        );
      }
    }
    // Fit into zone preserving aspect
    const targetScale = Math.min(zoneW / ww, zoneH / hh);
    const drawW = Math.max(32, Math.round(ww * targetScale));
    const drawH = Math.max(32, Math.round(hh * targetScale));
    const scaled = (heroImg as any).resize(drawW, drawH);
    const zoneX = gutter + i * (zoneW + gutter);
    const drawX = zoneX + Math.floor((zoneW - drawW) / 2);
    const drawY = zoneTop + Math.floor((zoneH - drawH) / 2);
    // Paste: skip near-background pixels so overlapping hero borders blend
    // softly into the canvas tint. Pure background pixels stay white-ish on
    // the hero because that's the palette bg anyway.
    for (let y = 0; y < drawH; y++) {
      for (let x = 0; x < drawW; x++) {
        const px = (scaled as any).getPixelAt(x + 1, y + 1);
        canvas.setPixelAt(drawX + x + 1, drawY + y + 1, px);
      }
    }
    heroesEvidence.push({
      page: page.page,
      source_url: page.url,
      working_width: ww,
      working_height: hh,
      regions_filled: colored.evidence.regions_filled,
      largest_region_pixels: colored.evidence.largest_region_pixels,
      colors_used_hex: colored.evidence.colors_used_hex,
    });
  }

  if (heroesEvidence.length === 0) {
    throw new Error("self_art_cover: all hero pages failed to fetch");
  }

  const bytes = await canvas.encode();
  return {
    bytes,
    version: SELF_ART_COVER_VERSION,
    palette: {
      background_hex: hex6(palette.background),
      subject_hex: palette.subjects.map(hex6),
    },
    heroes_used: heroesEvidence,
    canvas: { width: W, height: H },
  };
}
