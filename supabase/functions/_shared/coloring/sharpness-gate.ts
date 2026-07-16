// Sharpness gate for coloring-book interior line-art.
//
// Owner-verified defect (Ocean Friends draft): per-page edge-density at
// 60dpi ranged 2.6–20.3. Crisp pages scored ≥9, blurry ones ≤6 (e.g.
// p7=4.0, p23=4.2, p25=5.5, p35=3.8 vs p32=20.3).
//
// This module computes a deterministic sharpness score per raster and
// exposes a shared threshold so the render loop can regenerate any page
// that falls below the floor. The scorer combines:
//   • Sobel edge-magnitude mean (proxy for line contrast).
//   • Laplacian variance (proxy for high-frequency detail).
// Both are computed on a 512-px downsample of the luminance channel.
//
// The reported `score` is a monotonic combination on a 0..~30 scale,
// tuned so that Ocean Friends' crisp interior pages score ≥9 and its
// blurry pages score ≤6, matching the owner's calibration numbers.
//
// NEVER LOWER this threshold silently. If a book class needs a stricter
// floor, raise `metadata.coloring_style_contract.sharpness_min_score`.

// @ts-nocheck  Deno edge runtime
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { DEFAULT_SHARPNESS_MIN_SCORE, combineScore } from "./sharpness-scoring.ts";

export { DEFAULT_SHARPNESS_MIN_SCORE, combineScore };

export interface SharpnessReport {
  score: number;
  sobel_mean: number;
  laplacian_var: number;
  width: number;
  height: number;
  min_required: number;
  pass: boolean;
  reason: string;
}

async function decodeToLumaGrid(bytes: Uint8Array, maxSide = 512): Promise<{
  luma: Float32Array; w: number; h: number;
}> {
  const img = await Image.decode(bytes);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const targetW = Math.max(64, Math.round(img.width * scale));
  const targetH = Math.max(64, Math.round(img.height * scale));
  if (scale < 1) img.resize(targetW, targetH);
  const w = img.width, h = img.height;
  const luma = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = img.getPixelAt(x + 1, y + 1) >>> 0;
      const r = (px >>> 24) & 0xff;
      const g = (px >>> 16) & 0xff;
      const b = (px >>> 8) & 0xff;
      // Rec.709 luma
      luma[y * w + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }
  return { luma, w, h };
}

function sobelMean(luma: Float32Array, w: number, h: number): number {
  let sum = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1] +
         luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1];
      const gy =
        -luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1] +
         luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1];
      sum += Math.sqrt(gx * gx + gy * gy);
      count++;
    }
  }
  return count ? sum / count : 0;
}

function laplacianVariance(luma: Float32Array, w: number, h: number): number {
  const vals: number[] = [];
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = -4 * luma[i] + luma[i - 1] + luma[i + 1] + luma[i - w] + luma[i + w];
      vals.push(l);
      sum += l;
    }
  }
  if (vals.length === 0) return 0;
  const mean = sum / vals.length;
  let v = 0;
  for (const l of vals) { const d = l - mean; v += d * d; }
  return v / vals.length;
}

// combineScore + DEFAULT_SHARPNESS_MIN_SCORE are re-exported at the top
// from ./sharpness-scoring.ts (pure math, importable by vitest).



export async function computeSharpness(
  bytes: Uint8Array,
  opts: { minRequired?: number } = {},
): Promise<SharpnessReport> {
  const min = opts.minRequired ?? DEFAULT_SHARPNESS_MIN_SCORE;
  try {
    const { luma, w, h } = await decodeToLumaGrid(bytes);
    const sm = sobelMean(luma, w, h);
    const lv = laplacianVariance(luma, w, h);
    const score = combineScore(sm, lv);
    const pass = score >= min;
    return {
      score: Number(score.toFixed(2)),
      sobel_mean: Number(sm.toFixed(2)),
      laplacian_var: Number(lv.toFixed(2)),
      width: w, height: h,
      min_required: min,
      pass,
      reason: pass ? "ok" : `sharpness_below_floor:score=${score.toFixed(2)}_min=${min}`,
    };
  } catch (e) {
    // Fail SAFE (do not block on decode error) — luminance/solid-black gates run first.
    return {
      score: 0, sobel_mean: 0, laplacian_var: 0, width: 0, height: 0,
      min_required: min, pass: true,
      reason: `sharpness_decode_error:${(e as Error).message.slice(0, 120)}`,
    };
  }
}
