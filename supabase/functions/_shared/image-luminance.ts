// Deterministic dead-page detector (Gate 2).
//
// Decodes an image (PNG/JPEG) with ImageScript, downsamples to a small grid,
// and computes mean luminance + variance. Rejects near-solid black / white /
// gray pages that a vision LLM often misses because the "content" is empty.
//
// Thresholds are conservative: only pages that any human would call
// "obviously broken / not an illustration" trip the gate.

import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';

export interface LuminanceStats {
  mean: number;          // 0..255
  variance: number;      // pixel variance on the sampled grid
  dead: boolean;
  reason: string | null; // machine-readable reason when dead
}

const GRID = 64;

export async function computeLuminance(bytes: Uint8Array): Promise<LuminanceStats> {
  const img = await Image.decode(bytes);
  const w = img.width;
  const h = img.height;
  const stepX = Math.max(1, Math.floor(w / GRID));
  const stepY = Math.max(1, Math.floor(h / GRID));
  const samples: number[] = [];
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const px = img.getPixelAt(x + 1, y + 1); // 1-based per ImageScript
      // ImageScript packs pixels as 0xRRGGBBAA
      const r = (px >>> 24) & 0xff;
      const g = (px >>> 16) & 0xff;
      const b = (px >>> 8) & 0xff;
      // Rec. 709 luma
      const y709 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      samples.push(y709);
    }
  }
  const n = samples.length || 1;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;

  let reason: string | null = null;
  if (variance < 200) reason = 'flat_variance';
  if (mean < 12) reason = 'near_black';
  else if (mean > 243) reason = 'near_white';
  else if (variance < 400 && Math.abs(mean - 128) < 8) reason = 'flat_gray';
  return { mean, variance, dead: reason !== null, reason };
}

export async function computeLuminanceFromUrl(url: string): Promise<LuminanceStats | { error: string }> {
  try {
    const r = await fetch(url);
    if (!r.ok) return { error: `fetch ${r.status}` };
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < 1024) return { error: 'too_small' };
    return await computeLuminance(bytes);
  } catch (e) {
    return { error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// generateLiveImage — "dead frames are rejected at birth, not budgeted"
//
// Wraps a generator call with an in-call luminance retry loop. Callers pass a
// gen(attempt) fn that MAY jitter its own prompt or swap reference order based
// on `attempt`. Dead frames are NEVER persisted and NEVER count toward the
// caller's outer repair/cover budget — they trigger an immediate retry (up to
// `attempts`, default 3). Only when every in-call attempt returns dead do we
// throw and let the caller record a real, budget-worthy failure.
//
// Optional `meta` (finish reason, safety filters, part count, bytes length)
// from the generator is logged on every dead frame so we can root-cause why
// Gemini keeps returning near-black canvases.
// ---------------------------------------------------------------------------

export interface GenMeta {
  finishReason?: string | null;
  safetyRatings?: unknown;
  partCount?: number;
  bytesLen?: number;
  provider?: string;
  extra?: Record<string, unknown>;
}

export interface LiveImageResult {
  bytes: Uint8Array;
  lum: LuminanceStats;
  meta?: GenMeta;
  attempts_used: number;
}

export async function generateLiveImage(opts: {
  label: string;
  attempts?: number;
  gen: (attempt: number) => Promise<{ bytes: Uint8Array; meta?: GenMeta }>;
}): Promise<LiveImageResult> {
  const maxA = Math.max(1, opts.attempts ?? 3);
  let lastReason = 'no_attempt';
  let lastMeta: GenMeta | undefined;
  for (let a = 1; a <= maxA; a++) {
    let g: { bytes: Uint8Array; meta?: GenMeta };
    try {
      g = await opts.gen(a);
    } catch (e) {
      lastReason = `gen_error:${String((e as Error).message ?? e).slice(0, 220)}`;
      console.warn(`[generateLiveImage:${opts.label}] attempt ${a}/${maxA} threw`, lastReason);
      continue;
    }
    const lum = await computeLuminance(g.bytes);
    if (!lum.dead) {
      if (a > 1) console.log(`[generateLiveImage:${opts.label}] recovered on attempt ${a}/${maxA}`);
      return { bytes: g.bytes, lum, meta: g.meta, attempts_used: a };
    }
    lastReason = `${lum.reason}:mean=${lum.mean.toFixed(1)},var=${lum.variance.toFixed(0)}`;
    lastMeta = g.meta;
    console.warn(`[generateLiveImage:${opts.label}] attempt ${a}/${maxA} DEAD ${lastReason}`, JSON.stringify({
      meta: g.meta ?? null,
      bytes_len: g.bytes.length,
    }));
  }
  const err = new Error(`${opts.label}_dead_image_after_${maxA}_attempts:${lastReason}`);
  (err as unknown as { meta?: GenMeta }).meta = lastMeta;
  throw err;
}


