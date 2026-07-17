import { describe, it, expect } from "vitest";
import { fitContainCover } from "../../supabase/functions/_shared/coloring/pdf-cover-fit.ts";

// Round_2 regression: cover-crop-v3. Assembler must fit-CONTAIN the cover
// on the 612×792pt PDF page — never fit-COVER — so a baked title cannot be
// clipped even if the raster ratio drifts slightly from native 1600×2071.
const PAGE_W = 612;
const PAGE_H = 792;

describe("fitContainCover — coloring PDF page-1 placement", () => {
  it("fits the native 1600x2071 raster inside 612x792 with no overflow", () => {
    const p = fitContainCover(1600, 2071, PAGE_W, PAGE_H);
    expect(p.w).toBeLessThanOrEqual(PAGE_W + 0.001);
    expect(p.h).toBeLessThanOrEqual(PAGE_H + 0.001);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it("keeps a drifted 1620x2071 raster INSIDE the page (regression vs fit-COVER)", () => {
    // With the old Math.max (fit-COVER) placement this raster would have
    // overflowed by ~7pt on the sides — clipping the baked title. With
    // Math.min (fit-CONTAIN) it letterboxes safely instead.
    const p = fitContainCover(1620, 2071, PAGE_W, PAGE_H);
    expect(p.w).toBeLessThanOrEqual(PAGE_W);
    expect(p.h).toBeLessThanOrEqual(PAGE_H);
    // Compare to what fit-COVER would produce — must NOT match.
    const coverScale = Math.max(PAGE_W / 1620, PAGE_H / 2071);
    expect(p.scale).toBeLessThan(coverScale);
  });

  it("centers the placement", () => {
    const p = fitContainCover(1600, 2071, PAGE_W, PAGE_H);
    const leftMargin = p.x;
    const rightMargin = PAGE_W - (p.x + p.w);
    const topMargin = p.y;
    const bottomMargin = PAGE_H - (p.y + p.h);
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(0.001);
    expect(Math.abs(topMargin - bottomMargin)).toBeLessThan(0.001);
  });

  it("throws on invalid dims", () => {
    expect(() => fitContainCover(0, 100, 612, 792)).toThrow();
    expect(() => fitContainCover(100, 100, 0, 792)).toThrow();
  });
});
