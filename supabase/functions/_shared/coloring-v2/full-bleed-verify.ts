// cover_full_bleed_edge_verifier_v15
// Rejects covers that ship with a white/colored border, inner frame, or
// vignette-to-white edge. Samples the outer ring on each of the 4 edges
// and computes:
//   - whiteRatio: fraction of pixels close to pure white
//   - uniformRatio: fraction of pixels within a small delta of the edge's
//                   mean color (detects any solid-color frame, not just white)
// If any edge fails, verdict.pass = false and worstEdge/reason are set.
//
// Also provides autoCropBorders() as a last-resort rescue: trim the
// detected border rows/columns and resize back to the original canvas.
// @ts-nocheck  Deno runtime
import { decode, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

export type Edge = "top" | "bottom" | "left" | "right";

export interface FullBleedVerdict {
  pass: boolean;
  worstEdge: Edge | null;
  edges: Record<Edge, { whiteRatio: number; uniformRatio: number; borderPx: number }>;
  reason: string | null;
}

export interface FullBleedThresholds {
  ringFraction: number;  // fraction of the min-dimension to sample per edge
  whiteRatioMax: number; // fail if edge whiteRatio >= this
  uniformRatioMax: number; // fail if edge uniformRatio >= this
  whiteThreshold: number; // 0-255 R,G,B minimum for "white" pixel
  saturationMax: number;  // 0-255 max(RGB)-min(RGB) for "white" pixel
  uniformDelta: number;   // max L1 color distance to edge-mean to count as "uniform"
}

export const DEFAULT_FB_TH: FullBleedThresholds = {
  ringFraction: 0.02,
  whiteRatioMax: 0.40,
  uniformRatioMax: 0.85,
  whiteThreshold: 245,
  saturationMax: 12,
  uniformDelta: 18,
};

function pxRGB(pixel: number): [number, number, number] {
  // imagescript packs RGBA as 0xRRGGBBAA
  return [(pixel >>> 24) & 0xff, (pixel >>> 16) & 0xff, (pixel >>> 8) & 0xff];
}

function isWhitePx(r: number, g: number, b: number, th: FullBleedThresholds): boolean {
  if (r < th.whiteThreshold || g < th.whiteThreshold || b < th.whiteThreshold) return false;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return sat <= th.saturationMax;
}

// Sample one edge as a rectangular band of width `bandPx`.
function analyzeEdge(
  img: any,
  edge: Edge,
  bandPx: number,
  th: FullBleedThresholds,
): { whiteRatio: number; uniformRatio: number; meanRGB: [number, number, number] } {
  const w = img.width;
  const h = img.height;
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  if (edge === "top") y1 = bandPx;
  else if (edge === "bottom") y0 = h - bandPx;
  else if (edge === "left") x1 = bandPx;
  else if (edge === "right") x0 = w - bandPx;

  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  let whiteN = 0;
  // First pass: compute mean + white ratio
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // imagescript is 1-indexed for getPixelAt
      const p = img.getPixelAt(x + 1, y + 1);
      const [r, g, b] = pxRGB(p);
      sumR += r; sumG += g; sumB += b; n++;
      if (isWhitePx(r, g, b, th)) whiteN++;
    }
  }
  const mR = sumR / n, mG = sumG / n, mB = sumB / n;
  // Second pass: uniform ratio to mean
  let uniN = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = img.getPixelAt(x + 1, y + 1);
      const [r, g, b] = pxRGB(p);
      const d = Math.abs(r - mR) + Math.abs(g - mG) + Math.abs(b - mB);
      if (d <= th.uniformDelta) uniN++;
    }
  }
  return {
    whiteRatio: whiteN / n,
    uniformRatio: uniN / n,
    meanRGB: [mR, mG, mB],
  };
}

// Public: verify bytes (PNG or JPEG — imagescript decodes both).
export async function verifyFullBleed(
  bytes: Uint8Array,
  th: FullBleedThresholds = DEFAULT_FB_TH,
): Promise<FullBleedVerdict> {
  const img: any = await decode(bytes);
  const minDim = Math.min(img.width, img.height);
  const bandPx = Math.max(4, Math.round(minDim * th.ringFraction));
  const edges: Edge[] = ["top", "bottom", "left", "right"];
  const results = {} as FullBleedVerdict["edges"];
  let worstEdge: Edge | null = null;
  let worstScore = -Infinity;
  let reason: string | null = null;

  for (const e of edges) {
    const r = analyzeEdge(img, e, bandPx, th);
    results[e] = { whiteRatio: r.whiteRatio, uniformRatio: r.uniformRatio, borderPx: bandPx };
    // Combined "badness" — worse of whiteRatio and uniformRatio normalized by their thresholds.
    const score = Math.max(r.whiteRatio / th.whiteRatioMax, r.uniformRatio / th.uniformRatioMax);
    if (score > worstScore) {
      worstScore = score;
      worstEdge = e;
    }
    if (r.whiteRatio >= th.whiteRatioMax) {
      reason = reason ?? `edge_white_border:${e}`;
    } else if (r.uniformRatio >= th.uniformRatioMax) {
      reason = reason ?? `edge_uniform_frame:${e}`;
    }
  }
  const pass = reason === null;
  return { pass, worstEdge: pass ? null : worstEdge, edges: results, reason };
}

// Rescue: crop away borders that fail uniform-ratio then resize back to
// the original canvas. Deterministic — only trims edges that individually
// exceed the uniform threshold, so a healthy edge is never touched.
export async function autoCropBorders(
  bytes: Uint8Array,
  th: FullBleedThresholds = DEFAULT_FB_TH,
): Promise<{ bytes: Uint8Array; trimmed: Record<Edge, number>; originalW: number; originalH: number }> {
  const img: any = await decode(bytes);
  const W = img.width, H = img.height;
  const trimmed: Record<Edge, number> = { top: 0, bottom: 0, left: 0, right: 0 };

  const isBorderRow = (y: number): boolean => {
    let sumR = 0, sumG = 0, sumB = 0;
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pxRGB(img.getPixelAt(x + 1, y + 1));
      sumR += r; sumG += g; sumB += b;
    }
    const mR = sumR / W, mG = sumG / W, mB = sumB / W;
    let uniN = 0, whiteN = 0;
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pxRGB(img.getPixelAt(x + 1, y + 1));
      if (Math.abs(r - mR) + Math.abs(g - mG) + Math.abs(b - mB) <= th.uniformDelta) uniN++;
      if (isWhitePx(r, g, b, th)) whiteN++;
    }
    return (uniN / W) >= th.uniformRatioMax || (whiteN / W) >= th.whiteRatioMax;
  };
  const isBorderCol = (x: number): boolean => {
    let sumR = 0, sumG = 0, sumB = 0;
    for (let y = 0; y < H; y++) {
      const [r, g, b] = pxRGB(img.getPixelAt(x + 1, y + 1));
      sumR += r; sumG += g; sumB += b;
    }
    const mR = sumR / H, mG = sumG / H, mB = sumB / H;
    let uniN = 0, whiteN = 0;
    for (let y = 0; y < H; y++) {
      const [r, g, b] = pxRGB(img.getPixelAt(x + 1, y + 1));
      if (Math.abs(r - mR) + Math.abs(g - mG) + Math.abs(b - mB) <= th.uniformDelta) uniN++;
      if (isWhitePx(r, g, b, th)) whiteN++;
    }
    return (uniN / H) >= th.uniformRatioMax || (whiteN / H) >= th.whiteRatioMax;
  };
  // Cap trim to 15% per edge — beyond that we're eating artwork, not border.
  const maxTrim = Math.round(Math.min(W, H) * 0.15);
  while (trimmed.top < maxTrim && isBorderRow(trimmed.top)) trimmed.top++;
  while (trimmed.bottom < maxTrim && isBorderRow(H - 1 - trimmed.bottom)) trimmed.bottom++;
  while (trimmed.left < maxTrim && isBorderCol(trimmed.left)) trimmed.left++;
  while (trimmed.right < maxTrim && isBorderCol(W - 1 - trimmed.right)) trimmed.right++;

  const cropX = trimmed.left;
  const cropY = trimmed.top;
  const cropW = Math.max(1, W - trimmed.left - trimmed.right);
  const cropH = Math.max(1, H - trimmed.top - trimmed.bottom);
  const cropped = img.clone().crop(cropX, cropY, cropW, cropH).resize(W, H);
  const out = await cropped.encode(1); // PNG
  return { bytes: out, trimmed, originalW: W, originalH: H };
}
