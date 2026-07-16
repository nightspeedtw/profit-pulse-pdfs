// Regression tests for Defect Class 2 (interior sharpness gate).
//
// v5 (2026-07-16): the gate now measures ink-boundary transition quality
// (sparsity-invariant) rather than whole-image mean neighbour diff. These
// tests exercise `boundaryEdgeStrength` directly against synthetic luma
// grids covering the three calibration fixture sets required by the
// owner's root-cause brief:
//
//   1) crisp-busy  — dense crisp line art (accepted-set proxy) → PASS
//   2) crisp-sparse — toddler/senior style: mostly-white page with a
//      single large crisp subject → PASS (this was the false-fail class
//      that blocked Ocean Friends p3 under v4)
//   3) blurry — soft mushy transitions (owner-flagged p7/p23/p25/p35
//      proxy) → FAIL
//
// The Sobel + Laplacian scorer is exercised via combineScore against
// synthetic numeric fixtures (real ImageScript decode is Deno-only).

import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHARPNESS_MIN_SCORE,
  DEFAULT_BOUNDARY_EDGE_MIN_SCORE,
  MIN_BOUNDARY_PIXELS,
  SHARPNESS_GATE_VERSION,
  INK_LUMA,
  PAPER_LUMA,
  combineScore,
  boundaryEdgeStrength,
  passesBoundaryEdgeGate,
} from "../../supabase/functions/_shared/coloring/sharpness-scoring.ts";

// ---------- fixture builders ----------

function makeGrid(w: number, h: number, fill = 255): Float32Array {
  const g = new Float32Array(w * h);
  g.fill(fill);
  return g;
}

// Crisp rectangle: hard black interior on hard white paper.
function paintCrispRect(g: Float32Array, w: number, x0: number, y0: number, x1: number, y1: number, ink = 10) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = ink;
}

// Blurry rectangle: same target region, but transition ramps over `ramp` px.
function paintBlurryRect(
  g: Float32Array, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
  ink = 40, paper = 250, ramp = 6,
) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // distance INSIDE the target region is negative; outside positive.
      const dx = x < x0 ? x0 - x : x >= x1 ? x - (x1 - 1) : 0;
      const dy = y < y0 ? y0 - y : y >= y1 ? y - (y1 - 1) : 0;
      const dist = Math.max(dx, dy); // Chebyshev — square blur halo
      if (dist === 0) {
        g[y * w + x] = ink;
      } else if (dist <= ramp) {
        const t = dist / (ramp + 1);
        g[y * w + x] = ink + (paper - ink) * t;
      }
      // else leaves the pre-filled paper
    }
  }
}

// ---------- fixture set 1: crisp-busy (dense crisp) → PASS ----------

describe("boundary-edge gate — crisp-busy fixture (dense crisp lines)", () => {
  it("passes with high boundary score", () => {
    const W = 128, H = 128;
    const g = makeGrid(W, H, 255);
    // 8 horizontal 2px-thick crisp lines spanning the width
    for (let k = 1; k <= 8; k++) {
      const y = k * 14;
      paintCrispRect(g, W, 4, y, W - 4, y + 2, 5);
    }
    const { score, boundary_pixels } = boundaryEdgeStrength(g, W, H);
    expect(boundary_pixels).toBeGreaterThan(MIN_BOUNDARY_PIXELS);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_BOUNDARY_EDGE_MIN_SCORE);
    expect(passesBoundaryEdgeGate(boundary_pixels, score)).toBe(true);
  });
});

// ---------- fixture set 2: crisp-sparse → PASS (the v4 false-fail class) ----------

describe("boundary-edge gate — crisp-sparse fixture (toddler/senior contract)", () => {
  it("large mostly-white page with a single crisp subject PASSES", () => {
    const W = 256, H = 256;
    const g = makeGrid(W, H, 255);
    // one crisp filled block occupying ~4% of the page
    paintCrispRect(g, W, 110, 110, 146, 146, 5);
    const { score, boundary_pixels } = boundaryEdgeStrength(g, W, H);
    expect(boundary_pixels).toBeGreaterThan(MIN_BOUNDARY_PIXELS);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_BOUNDARY_EDGE_MIN_SCORE);
    // The v4 whole-image mean-neighbor-diff over this raster would be
    // tiny (~3-4) and would fail the old 6.5 floor. The v5 gate must not.
    expect(passesBoundaryEdgeGate(boundary_pixels, score)).toBe(true);
  });

  it("Ocean Friends p3 analogue: single crisp portrait subject PASSES", () => {
    // Mirrors persisted evidence for a05a5086 p3 ("whale friendly portrait,
    // plain white background") — crisp lines on a mostly white raster.
    const W = 300, H = 400; // portrait 4:3-ish
    const g = makeGrid(W, H, 255);
    // Rough whale silhouette: body + tail bounds, all crisp
    paintCrispRect(g, W, 80, 160, 240, 220, 8);   // body
    paintCrispRect(g, W, 220, 130, 260, 250, 8);  // tail
    paintCrispRect(g, W, 100, 178, 108, 186, 8);  // eye dot
    const { score, boundary_pixels } = boundaryEdgeStrength(g, W, H);
    expect(boundary_pixels).toBeGreaterThan(MIN_BOUNDARY_PIXELS);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_BOUNDARY_EDGE_MIN_SCORE);
  });

  it("legacy Sobel/Laplacian score below 13 cannot veto a boundary pass", () => {
    const W = 256, H = 256;
    const g = makeGrid(W, H, 255);
    paintCrispRect(g, W, 118, 118, 138, 138, 5);
    const { score, boundary_pixels, ink_pixels } = boundaryEdgeStrength(g, W, H);
    const legacyScore = combineScore(12, 0); // 3.0 — below legacy floor 13
    expect(legacyScore).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_BOUNDARY_EDGE_MIN_SCORE);
    expect(passesBoundaryEdgeGate(boundary_pixels, score, DEFAULT_BOUNDARY_EDGE_MIN_SCORE, ink_pixels)).toBe(true);
  });
});

// ---------- fixture set 3: blurry → FAIL ----------

describe("boundary-edge gate — blurry fixture (owner-flagged p7/p23/p25/p35 proxy)", () => {
  it("dense mushy transitions FAIL the gate (ink present, no crisp boundary)", () => {
    const W = 200, H = 200;
    const g = makeGrid(W, H, 250);
    for (let bx = 20; bx < 180; bx += 40) {
      for (let by = 20; by < 180; by += 40) {
        paintBlurryRect(g, W, H, bx, by, bx + 18, by + 18, 40, 250, 6);
      }
    }
    const { score, boundary_pixels, ink_pixels } = boundaryEdgeStrength(g, W, H);
    // Ink present in bulk but the ramp is too soft for any ink pixel to
    // sit adjacent to a paper-luma pixel → mushy → hard fail.
    expect(ink_pixels).toBeGreaterThan(100);
    expect(passesBoundaryEdgeGate(boundary_pixels, score, DEFAULT_BOUNDARY_EDGE_MIN_SCORE, ink_pixels)).toBe(false);
  });

  it("gradient-only image (no crisp lines anywhere) FAILS", () => {
    const W = 128, H = 128;
    const g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = 30 + (x / W) * 220;
    const { score, boundary_pixels, ink_pixels } = boundaryEdgeStrength(g, W, H);
    expect(ink_pixels).toBeGreaterThan(100);
    expect(passesBoundaryEdgeGate(boundary_pixels, score, DEFAULT_BOUNDARY_EDGE_MIN_SCORE, ink_pixels)).toBe(false);
  });
});

// ---------- inapplicability: fully blank page ----------

describe("boundary-edge gate — inapplicability contract", () => {
  it("fully blank raster returns 0 ink pixels and defers (pass=true)", () => {
    const W = 64, H = 64;
    const g = makeGrid(W, H, 255);
    const { score, boundary_pixels, ink_pixels } = boundaryEdgeStrength(g, W, H);
    expect(ink_pixels).toBe(0);
    expect(boundary_pixels).toBe(0);
    expect(score).toBe(0);
    expect(passesBoundaryEdgeGate(boundary_pixels, score, DEFAULT_BOUNDARY_EDGE_MIN_SCORE, ink_pixels)).toBe(true);
  });
});

// ---------- inapplicability: fully blank page ----------

describe("boundary-edge gate — inapplicability contract", () => {
  it("fully blank raster returns 0 boundary pixels and defers (pass=true)", () => {
    const W = 64, H = 64;
    const g = makeGrid(W, H, 255);
    const { score, boundary_pixels } = boundaryEdgeStrength(g, W, H);
    expect(boundary_pixels).toBe(0);
    expect(score).toBe(0);
    // Deferral: blank pages are the black-density gate's job, not blur's.
    expect(passesBoundaryEdgeGate(boundary_pixels, score)).toBe(true);
  });
});

// ---------- version + threshold constants ----------

describe("sharpness gate — versioned constants", () => {
  it("exports v5 gate version", () => {
    expect(SHARPNESS_GATE_VERSION.startsWith("v5:")).toBe(true);
  });
  it("boundary floor is 140 (fixture calibration, do not lower silently)", () => {
    expect(DEFAULT_BOUNDARY_EDGE_MIN_SCORE).toBe(140);
  });
  it("legacy combined floor still exported at 13.0 for secondary safety", () => {
    expect(DEFAULT_SHARPNESS_MIN_SCORE).toBe(13.0);
  });
  it("ink/paper thresholds bracket a clear white-gap band", () => {
    expect(INK_LUMA).toBeLessThan(PAPER_LUMA);
    expect(PAPER_LUMA - INK_LUMA).toBeGreaterThanOrEqual(24);
  });
});

// ---------- sobel/laplacian combiner (unchanged) ----------

describe("sharpness gate — combined Sobel/Laplacian score", () => {
  it("increasing Sobel with fixed Laplacian never decreases score", () => {
    expect(combineScore(10, 100)).toBeLessThanOrEqual(combineScore(20, 100));
    expect(combineScore(20, 100)).toBeLessThanOrEqual(combineScore(40, 100));
  });
  it("increasing Laplacian with fixed Sobel never decreases score", () => {
    expect(combineScore(10, 0)).toBeLessThanOrEqual(combineScore(10, 400));
    expect(combineScore(10, 400)).toBeLessThanOrEqual(combineScore(10, 4000));
  });
  it("dead-flat page fails combined floor", () => {
    expect(combineScore(2, 0)).toBeLessThan(DEFAULT_SHARPNESS_MIN_SCORE);
  });
});
