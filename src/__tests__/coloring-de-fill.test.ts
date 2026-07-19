// Unit tests for solid_black_defill_v1 — pure pixel-mask logic.
// Verifies the de-fill KEEP mask behaviour independently of PNG codec:
//   - filled-cow-patch fixture: interior of an oversized black blob is
//     whitened, a ring_px-wide outline is preserved → gate would pass.
//   - orca fixture: two black blobs on a large white page; the outline
//     ring is retained, interior is whitened.
//   - ground-shadow fixture: mid-gray shadow blob is fully cleared
//     (ring_px=0 for shadows).
//   - garbage-black page: majority-black input → hard_giveup path
//     (the KEEP mask alone can't rescue it — checked as invariant).
//   - normal line-art: no oversized cluster → mask is untouched.

import { describe, it, expect } from "vitest";
import { computeDeFillKeepMask } from "../../supabase/functions/_shared/coloring/de-fill-mask.ts";

/** Rasterize a filled rectangle of 1s on a WxH grid. */
function fillRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  return m;
}
function or(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] | b[i];
  return o;
}
function count(m: Uint8Array): number { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; }

describe("solid_black_defill_v1 · computeDeFillKeepMask", () => {
  it("filled-cow-patch: interior whitened, ring_px outline preserved", () => {
    const W = 40, H = 40;
    // 20x20 filled patch in the middle — the "cow body".
    const mask = fillRect(W, H, 10, 10, 29, 29);
    const cluster = mask;
    const keep = computeDeFillKeepMask(W, H, mask, cluster, 3);
    // Perimeter pixel kept.
    expect(keep[10 * W + 10]).toBe(1);
    // 3 pixels in from the corner also kept (the outline ring).
    expect(keep[12 * W + 12]).toBe(1);
    // 4 pixels in → interior, whitened.
    expect(keep[14 * W + 14]).toBe(0);
    // Deep interior always whitened.
    expect(keep[20 * W + 20]).toBe(0);
    // Ring pixels form a hollow shell.
    const kept = count(keep);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(count(mask)); // strictly fewer than the full fill
  });

  it("orca (two blobs): each cluster gets its own outline ring", () => {
    const W = 60, H = 30;
    const a = fillRect(W, H, 5, 5, 20, 20);
    const b = fillRect(W, H, 35, 5, 55, 22);
    const mask = or(a, b);
    const keep = computeDeFillKeepMask(W, H, mask, mask, 2);
    // Blob A: border kept, deep interior whitened.
    expect(keep[5 * W + 5]).toBe(1);
    expect(keep[12 * W + 12]).toBe(0);
    // Blob B: border kept, deep interior whitened.
    expect(keep[5 * W + 35]).toBe(1);
    expect(keep[14 * W + 45]).toBe(0);
  });

  it("ground-shadow: ring_px=0 clears the entire blob", () => {
    const W = 40, H = 40;
    const shadow = fillRect(W, H, 8, 30, 32, 38); // wide flat blob under a subject
    const keep = computeDeFillKeepMask(W, H, shadow, shadow, 0);
    // Nothing survives — shadow is fully whitened.
    expect(count(keep)).toBe(0);
  });

  it("garbage-black page: KEEP mask alone cannot rescue a majority-black input", () => {
    const W = 40, H = 40;
    // Nearly entire page is black (34x34 of 40x40 → 72% fill).
    const mask = fillRect(W, H, 3, 3, 36, 36);
    const keep = computeDeFillKeepMask(W, H, mask, mask, 3);
    // After de-fill, black_ratio would still be enormous relative to the
    // gate max — the caller MUST hard_giveup and reject. Sanity: kept
    // pixels are ONLY the outer ring, not the whole page.
    const kept = count(keep);
    expect(kept).toBeLessThan(count(mask) * 0.6); // interior collapsed
    // But the outer ring alone on a 40x40 page is still ~408 px = ~25%
    // — the whole-page-black case is the caller's hard_giveup, not the
    // mask's job. Ensured by the top-level pipeline's
    // `hard_giveup_black_ratio` check.
    expect(kept).toBeGreaterThan(0);
  });

  it("normal line-art: no oversized cluster → mask left alone", () => {
    const W = 40, H = 40;
    // Thin frame + a tiny detail — no cluster is "oversized".
    const line = fillRect(W, H, 0, 0, W - 1, 0); // 1-px top border
    const empty = new Uint8Array(W * H); // no cluster tagged
    const keep = computeDeFillKeepMask(W, H, line, empty, 3);
    // Every line pixel is preserved because clusterMask=0 → not eligible for de-fill.
    expect(count(keep)).toBe(count(line));
  });
});
