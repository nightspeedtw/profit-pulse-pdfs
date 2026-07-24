// @ts-nocheck
// cover_full_bleed_edge_verifier_v15
// Confirms verifyFullBleed rejects images that have a white/uniform border
// and accepts images that are painted edge-to-edge.
import { describe, it, expect } from "vitest";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { verifyFullBleed } from "../../supabase/functions/_shared/coloring-v2/full-bleed-verify.ts";

// Build a 256x256 image with a solid-color interior and an optional border.
async function makeImage(borderPx: number, borderRGB: [number, number, number], fillRGB: [number, number, number]): Promise<Uint8Array> {
  const W = 256, H = 256;
  const img = new Image(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inBorder =
        x < borderPx || x >= W - borderPx || y < borderPx || y >= H - borderPx;
      const [r, g, b] = inBorder ? borderRGB : fillRGB;
      // imagescript setPixelAt uses 1-indexed coords, packed 0xRRGGBBAA
      const px = ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff;
      img.setPixelAt(x + 1, y + 1, px >>> 0);
    }
  }
  return await img.encode(1);
}

describe("verifyFullBleed — cover_full_bleed_edge_verifier_v15", () => {
  it("rejects an image with a white border on all four edges", async () => {
    const bytes = await makeImage(24, [255, 255, 255], [40, 120, 200]);
    const v = await verifyFullBleed(bytes);
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/edge_white_border/);
  }, 15_000);

  it("rejects an image with a solid non-white uniform frame", async () => {
    const bytes = await makeImage(24, [10, 10, 10], [200, 40, 120]);
    const v = await verifyFullBleed(bytes);
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/edge_white_border|edge_uniform_frame/);
  }, 15_000);

  it("accepts a fully painted edge-to-edge image", async () => {
    // No border, but add small per-pixel jitter so uniformRatio stays under threshold.
    const W = 256, H = 256;
    const img = new Image(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = 40 + ((x * 3 + y) % 60);
        const g = 120 + ((x + y * 2) % 50);
        const b = 200 + ((x * 5 + y * 3) % 40);
        const px = ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff;
        img.setPixelAt(x + 1, y + 1, px >>> 0);
      }
    }
    const bytes = await img.encode(1);
    const v = await verifyFullBleed(bytes);
    expect(v.pass).toBe(true);
    expect(v.reason).toBeNull();
  }, 15_000);
});
