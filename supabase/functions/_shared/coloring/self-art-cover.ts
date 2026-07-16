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
import { colorizeLineArt, SELF_ART_COVER_VERSION, type ColorizeEvidence } from "./self-art-colorize.ts";

export { colorizeLineArt, SELF_ART_COVER_VERSION } from "./self-art-colorize.ts";

export interface SelfArtSourcePage {
  page: number;
  url: string;
}

export interface SelfArtCoverInput {
  categoryKey: string | null | undefined;
  categoryName: string;
  pages: SelfArtSourcePage[];
  maxHeroes?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  workingSize?: number;
  seed?: number | string | null;
}

export interface FloodFillPageEvidence extends ColorizeEvidence {
  page: number;
  source_url: string;
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

function hex6(n: number): string {
  return "#" + (n & 0xFFFFFF).toString(16).padStart(6, "0").toUpperCase();
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

function shadePixel(rgb: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((rgb >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((rgb >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((rgb & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

function paintCanvasWithVerticalWash(canvas: any, W: number, H: number, base: number) {
  // Soft two-tone vertical background wash for a Crayola-style card feel.
  const light = shadePixel(base, 1.08);
  const dark = shadePixel(base, 0.94);
  for (let y = 0; y < H; y++) {
    const t = y / Math.max(1, H - 1);
    const r = Math.round(((light >> 16) & 0xff) * (1 - t) + ((dark >> 16) & 0xff) * t);
    const g = Math.round(((light >> 8) & 0xff) * (1 - t) + ((dark >> 8) & 0xff) * t);
    const b = Math.round((light & 0xff) * (1 - t) + (dark & 0xff) * t);
    const px = (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff) >>> 0;
    for (let x = 0; x < W; x++) canvas.setPixelAt(x + 1, y + 1, px);
  }
}

function drawRoundedFrame(canvas: any, W: number, H: number, base: number) {
  // Decorative rounded frame ~inset by 4% with a darker palette accent.
  const inset = Math.round(Math.min(W, H) * 0.04);
  const thickness = Math.max(4, Math.round(Math.min(W, H) * 0.008));
  const radius = Math.round(Math.min(W, H) * 0.05);
  const frameCol = shadePixel(base, 0.65);
  const px = (((frameCol >> 16) & 0xff) << 24 | ((frameCol >> 8) & 0xff) << 16 | (frameCol & 0xff) << 8 | 0xff) >>> 0;
  const inCorner = (x: number, y: number, cx: number, cy: number) => {
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = inset; y < H - inset; y++) {
    for (let x = inset; x < W - inset; x++) {
      const onEdge =
        x < inset + thickness || x >= W - inset - thickness ||
        y < inset + thickness || y >= H - inset - thickness;
      if (!onEdge) continue;
      // Rounded corners: skip pixels outside corner arcs
      if (x < inset + radius && y < inset + radius && !inCorner(x, y, inset + radius, inset + radius)) continue;
      if (x >= W - inset - radius && y < inset + radius && !inCorner(x, y, W - inset - radius - 1, inset + radius)) continue;
      if (x < inset + radius && y >= H - inset - radius && !inCorner(x, y, inset + radius, H - inset - radius - 1)) continue;
      if (x >= W - inset - radius && y >= H - inset - radius && !inCorner(x, y, W - inset - radius - 1, H - inset - radius - 1)) continue;
      canvas.setPixelAt(x + 1, y + 1, px);
    }
  }
}

function drawDropShadow(canvas: any, cx: number, cy: number, w: number, h: number, W: number, H: number) {
  // Elliptical soft shadow beneath a hero region.
  const shadowY = cy + h * 0.5;
  const rx = w * 0.42;
  const ry = Math.max(6, h * 0.06);
  const y0 = Math.max(0, Math.floor(shadowY - ry * 1.4));
  const y1 = Math.min(H, Math.ceil(shadowY + ry * 1.6));
  const x0 = Math.max(0, Math.floor(cx - rx * 1.2));
  const x1 = Math.min(W, Math.ceil(cx + rx * 1.2));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - shadowY) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1.4) continue;
      const strength = Math.max(0, 0.35 * (1 - d / 1.4));
      const cur = canvas.getPixelAt(x + 1, y + 1);
      const r = Math.round(((cur >>> 24) & 0xff) * (1 - strength));
      const g = Math.round(((cur >>> 16) & 0xff) * (1 - strength));
      const b = Math.round(((cur >>> 8) & 0xff) * (1 - strength));
      canvas.setPixelAt(x + 1, y + 1, (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff) >>> 0);
    }
  }
}

/**
 * Compose the final self-art cover PNG. Beautified rung-2 look:
 *   - vertical two-tone palette wash background
 *   - soft elliptical drop shadow under each hero
 *   - colorized hero art (per-region two-tone flood fill)
 *   - decorative rounded palette-accent frame
 * Deterministic. No AI, no external fonts.
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

  const canvas = new Image(W, H);
  paintCanvasWithVerticalWash(canvas, W, H, palette.background);

  const gutter = Math.round(W * 0.03);
  const zoneW = Math.floor((W - gutter * (chosen.length + 1)) / chosen.length);
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
    const colored = colorizeLineArt(rgba, ww, hh, palette, { beautify: true });
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
    const targetScale = Math.min(zoneW / ww, zoneH / hh);
    const drawW = Math.max(32, Math.round(ww * targetScale));
    const drawH = Math.max(32, Math.round(hh * targetScale));
    const scaled = (heroImg as any).resize(drawW, drawH);
    const zoneX = gutter + i * (zoneW + gutter);
    const drawX = zoneX + Math.floor((zoneW - drawW) / 2);
    const drawY = zoneTop + Math.floor((zoneH - drawH) / 2);
    // Drop shadow first, hero over it.
    drawDropShadow(canvas, drawX + drawW / 2, drawY + drawH / 2, drawW, drawH, W, H);
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

  // Decorative frame drawn last so it sits above the wash + heroes.
  drawRoundedFrame(canvas, W, H, palette.background);

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

