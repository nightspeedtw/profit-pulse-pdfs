// Deterministic solid-black area detector. Coloring pages must be MOSTLY
// white with black CONTOURS — large filled black regions destroy colorable
// space and hard-fail the page.
//
// Strategy: decode the image bytes to raw RGBA via `imagescript` (pure Deno,
// no native deps), downscale-sample, and compute:
//   - black_pixel_ratio  (pixels darker than threshold / total)
//   - largest_black_cluster_ratio  (largest 4-connected black region / total)
// Fail when black_pixel_ratio > MAX_BLACK_RATIO OR
// largest cluster > MAX_CLUSTER_RATIO (indicates a filled shape, not lines).

// @ts-nocheck  Deno runtime
import { decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

export interface SolidBlackReport {
  black_pixel_ratio: number;
  largest_black_cluster_ratio: number;
  white_pixel_ratio: number;
  pass: boolean;
  reasons: string[];
}

export interface SolidBlackThresholds {
  black_threshold: number;       // 0-255 luminance cutoff
  white_threshold: number;       // 0-255 luminance cutoff
  max_black_ratio: number;       // e.g. 0.18 = up to 18% of pixels may be black (line art)
  max_cluster_ratio: number;     // e.g. 0.04 = no single filled black blob > 4%
  min_white_ratio: number;       // background must be dominantly white
  max_sample_dim: number;        // downscale for speed
}

export const DEFAULT_SOLID_BLACK_TH: SolidBlackThresholds = {
  black_threshold: 60,
  white_threshold: 235,
  max_black_ratio: 0.18,
  max_cluster_ratio: 0.04,
  min_white_ratio: 0.72,
  max_sample_dim: 384,
};

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export async function analyzeSolidBlack(
  bytes: Uint8Array,
  th: SolidBlackThresholds = DEFAULT_SOLID_BLACK_TH,
): Promise<SolidBlackReport> {
  const img: any = await decode(bytes);
  const scale = Math.min(1, th.max_sample_dim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const resized: any = scale < 1 ? img.resize(w, h) : img;

  const total = w * h;
  const mask = new Uint8Array(total);
  let blackCount = 0;
  let whiteCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = resized.getPixelAt(x + 1, y + 1); // imagescript is 1-indexed, returns RGBA int
      const r = (px >> 24) & 0xff;
      const g = (px >> 16) & 0xff;
      const b = (px >> 8) & 0xff;
      const l = luminance(r, g, b);
      if (l <= th.black_threshold) {
        mask[y * w + x] = 1;
        blackCount++;
      } else if (l >= th.white_threshold) {
        whiteCount++;
      }
    }
  }

  // Flood-fill largest black cluster (4-connected, iterative).
  let largest = 0;
  const seen = new Uint8Array(total);
  const stack: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      size++;
      const x = idx % w;
      const y = (idx - x) / w;
      const neigh = [
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
      ];
      for (const n of neigh) {
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (size > largest) largest = size;
  }

  const black_pixel_ratio = blackCount / total;
  const white_pixel_ratio = whiteCount / total;
  const largest_black_cluster_ratio = largest / total;
  const reasons: string[] = [];
  if (black_pixel_ratio > th.max_black_ratio)
    reasons.push(`black_pixel_ratio=${black_pixel_ratio.toFixed(3)} > ${th.max_black_ratio}`);
  if (largest_black_cluster_ratio > th.max_cluster_ratio)
    reasons.push(`largest_black_cluster_ratio=${largest_black_cluster_ratio.toFixed(3)} > ${th.max_cluster_ratio} (solid-fill region)`);
  if (white_pixel_ratio < th.min_white_ratio)
    reasons.push(`white_pixel_ratio=${white_pixel_ratio.toFixed(3)} < ${th.min_white_ratio}`);

  return {
    black_pixel_ratio,
    largest_black_cluster_ratio,
    white_pixel_ratio,
    pass: reasons.length === 0,
    reasons,
  };
}
