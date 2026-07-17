import { describe, it, expect } from "vitest";
import {
  checkCoverAspect,
  probeImageSize,
  COLORING_COVER_NATIVE_W,
  COLORING_COVER_NATIVE_H,
} from "../../supabase/functions/_shared/coloring/cover-aspect-gate.ts";

// Synthesize a minimal PNG header (8B sig + IHDR len(4) + "IHDR"(4) + W(4) + H(4) + rest)
function fakePng(w: number, h: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(buf.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return buf;
}

describe("coloring cover aspect gate — round_2 CLASS: cover-aspect-mismatch", () => {
  it("passes on the native 1600x2071 asset", () => {
    const r = checkCoverAspect(fakePng(COLORING_COVER_NATIVE_W, COLORING_COVER_NATIVE_H));
    expect(r.pass).toBe(true);
    expect(r.width).toBe(1600);
    expect(r.height).toBe(2071);
  });

  it("FAILS a square asset (regression: object-cover would clip baked title)", () => {
    const r = checkCoverAspect(fakePng(1024, 1024));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/cover_aspect_mismatch/);
  });

  it("FAILS a 4:5 (1024x1280) asset — kids picture-book ratio, wrong for coloring", () => {
    const r = checkCoverAspect(fakePng(1024, 1280));
    expect(r.pass).toBe(false);
  });

  it("FAILS a 3:4 (1200x1600) asset — Ideogram raw output before trim", () => {
    const r = checkCoverAspect(fakePng(1200, 1600));
    expect(r.pass).toBe(false);
  });

  it("passes a 800x1035 half-size render (same ratio)", () => {
    const r = checkCoverAspect(fakePng(800, 1035));
    expect(r.pass).toBe(true);
  });

  it("returns unrecognised_image_header for junk bytes", () => {
    const r = checkCoverAspect(new Uint8Array([1, 2, 3, 4]));
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("unrecognised_image_header");
  });

  it("probeImageSize reads a PNG header", () => {
    expect(probeImageSize(fakePng(1600, 2071))).toEqual({ w: 1600, h: 2071 });
  });
});
