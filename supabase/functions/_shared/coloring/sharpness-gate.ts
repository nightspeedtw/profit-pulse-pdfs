// Sharpness gate for coloring-book interior line-art.
//
// v6 root-cause completion (2026-07-16): boundary_edge_strength is the ONLY
// sharpness decision authority; Sobel/Laplacian/global scores are telemetry.
// v5 root-cause fix (2026-07-16): replaced the whole-image
// `visible_edge_score` mean-neighbor-diff (which confounded SPARSITY with
// BLUR and false-failed replanned portrait pages like Ocean Friends p3)
// with `boundary_edge_strength`: mean ink→paper luma delta measured ONLY
// on ink-boundary pixels. See ./sharpness-scoring.ts header for the full
// evidence trail. This is a metric correction, NOT a threshold reduction.
//
// The combined Sobel+Laplacian score is preserved as TELEMETRY only. It is
// intentionally not an AND-condition: whole-image/global scores were proven
// to confound sparse-by-design toddler/senior pages with blur.

// @ts-nocheck  Deno edge runtime
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import {
  DEFAULT_SHARPNESS_MIN_SCORE,
  DEFAULT_VISIBLE_EDGE_MIN_SCORE,
  DEFAULT_BOUNDARY_EDGE_MIN_SCORE,
  MIN_BOUNDARY_PIXELS,
  SHARPNESS_GATE_VERSION,
  combineScore,
  boundaryEdgeStrength,
  passesBoundaryEdgeGate,
  passesSharpnessGate,
  passesVisibleBlurBoundary,
} from "./sharpness-scoring.ts";

export {
  DEFAULT_SHARPNESS_MIN_SCORE,
  DEFAULT_VISIBLE_EDGE_MIN_SCORE,
  DEFAULT_BOUNDARY_EDGE_MIN_SCORE,
  MIN_BOUNDARY_PIXELS,
  SHARPNESS_GATE_VERSION,
  combineScore,
  boundaryEdgeStrength,
  passesBoundaryEdgeGate,
  passesSharpnessGate,
  passesVisibleBlurBoundary,
};

export interface SharpnessReport {
  score: number;
  sobel_mean: number;
  laplacian_var: number;
  width: number;
  height: number;
  min_required: number;
  // Historical whole-image density (kept for telemetry; not gated).
  visible_edge_score: number;
  visible_edge_min_required: number;
  // v5 gate: sparsity-invariant ink-boundary contrast.
  boundary_edge_strength: number;
  boundary_edge_min_required: number;
  boundary_pixel_count: number;
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
      luma[y * w + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }
  return { luma, w, h };
}

function sobelMean(luma: Float32Array, w: number, h: number): number {
  let sum = 0, count = 0;
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

function meanNeighborDiffTelemetry(luma: Float32Array, w: number, h: number): number {
  let sum = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      sum += Math.abs(luma[y * w + x] - luma[y * w + x - 1]);
      count++;
    }
  }
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sum += Math.abs(luma[y * w + x] - luma[(y - 1) * w + x]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

export async function computeSharpness(
  bytes: Uint8Array,
  opts: { minRequired?: number; boundaryMinRequired?: number } = {},
): Promise<SharpnessReport> {
  const min = opts.minRequired ?? DEFAULT_SHARPNESS_MIN_SCORE;
  const boundaryMin = opts.boundaryMinRequired ?? DEFAULT_BOUNDARY_EDGE_MIN_SCORE;
  try {
    const { luma, w, h } = await decodeToLumaGrid(bytes);
    const sm = sobelMean(luma, w, h);
    const lv = laplacianVariance(luma, w, h);
    const score = combineScore(sm, lv);
    const visible = meanNeighborDiffTelemetry(luma, w, h);
    const boundary = boundaryEdgeStrength(luma, w, h);
    const boundaryPass = passesSharpnessGate({
      legacy_score: score,
      legacy_min: min,
      boundary_pixels: boundary.boundary_pixels,
      boundary_score: boundary.score,
      boundary_min: boundaryMin,
      ink_pixels: boundary.ink_pixels,
    });
    // v5 authority: boundary edge strength only. `score` (Sobel+Laplacian)
    // remains persisted telemetry/trend data and MUST NOT veto sparse pages.
    const pass = boundaryPass;
    const reason = pass
      ? "ok"
      : `boundary_blur_below_floor:score=${boundary.score.toFixed(2)}_min=${boundaryMin}_boundary_pixels=${boundary.boundary_pixels}_ink_pixels=${boundary.ink_pixels}`;
    return {
      score: Number(score.toFixed(2)),
      sobel_mean: Number(sm.toFixed(2)),
      laplacian_var: Number(lv.toFixed(2)),
      width: w, height: h,
      min_required: min,
      visible_edge_score: Number(visible.toFixed(2)),
      visible_edge_min_required: DEFAULT_VISIBLE_EDGE_MIN_SCORE,
      boundary_edge_strength: Number(boundary.score.toFixed(2)),
      boundary_edge_min_required: boundaryMin,
      boundary_pixel_count: boundary.boundary_pixels,
      pass,
      reason,
    };
  } catch (e) {
    // Fail closed on decode error.
    return {
      score: 0, sobel_mean: 0, laplacian_var: 0, width: 0, height: 0,
      min_required: min,
      visible_edge_score: 0, visible_edge_min_required: DEFAULT_VISIBLE_EDGE_MIN_SCORE,
      boundary_edge_strength: 0, boundary_edge_min_required: boundaryMin, boundary_pixel_count: 0,
      pass: false,
      reason: `sharpness_decode_error:${(e as Error).message.slice(0, 120)}`,
    };
  }
}
