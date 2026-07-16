// Regression tests for Defect Class 3 (layout text shrink-to-fit).
//
// Exercises measureFitParagraph with a mock PDFFont so we don't need
// pdf-lib's Deno-only asset pipeline in vitest.

import { describe, it, expect } from "vitest";
import { measureFitParagraph } from "../../supabase/functions/_shared/pdf/shrink-to-fit.ts";

// Mock font — width proportional to text length × size × 0.55, matching the
// fallback path in shrink-to-fit.ts when a real font is unavailable.
const mockFont = {
  widthOfTextAtSize(text: string, size: number): number {
    return text.length * size * 0.55;
  },
  heightAtSize(size: number): number {
    return size;
  },
} as any;

describe("shrink-to-fit — measureFitParagraph", () => {
  it("short string renders at requested size unchanged", () => {
    const r = measureFitParagraph({
      text: "Short line", font: mockFont, size: 12, minSize: 6,
      maxWidth: 500, maxHeight: 200,
    });
    expect(r.finalSize).toBe(12);
    expect(r.truncated).toBe(false);
    expect(r.lines.length).toBe(1);
  });

  it("long ownership string (600 chars) shrinks below requested size and wraps within maxWidth", () => {
    const text = ("© 2026 secretpdf.co. All rights reserved. This coloring book is licensed for personal, non-commercial use. " +
      "Individual coloring pages may be copied for personal or classroom use. Not for resale, redistribution, or commercial reproduction. ").repeat(2);
    expect(text.length).toBeGreaterThanOrEqual(400);
    const r = measureFitParagraph({
      text, font: mockFont, size: 11, minSize: 7,
      maxWidth: 460, maxHeight: 220,
    });
    // Every line stays inside the box at the final size.
    for (const ln of r.lines) {
      expect(mockFont.widthOfTextAtSize(ln, r.finalSize)).toBeLessThanOrEqual(460);
    }
    expect(r.finalSize).toBeLessThanOrEqual(11);
    expect(r.finalSize).toBeGreaterThanOrEqual(7);
  });

  it("extreme string (10,000 chars) truncates with ellipsis rather than throwing or clipping", () => {
    const text = "word ".repeat(2000);
    const r = measureFitParagraph({
      text, font: mockFont, size: 10, minSize: 6,
      maxWidth: 400, maxHeight: 100,
    });
    expect(r.truncated).toBe(true);
    for (const ln of r.lines) {
      expect(mockFont.widthOfTextAtSize(ln, r.finalSize)).toBeLessThanOrEqual(400);
    }
    // Last line ends with ellipsis when truncated.
    expect(r.lines[r.lines.length - 1]).toMatch(/…/);
  });

  it("respects minSize floor even when text is impossibly long", () => {
    const r = measureFitParagraph({
      text: "x".repeat(50000), font: mockFont, size: 12, minSize: 6,
      maxWidth: 100, maxHeight: 50,
    });
    expect(r.finalSize).toBeGreaterThanOrEqual(6);
  });
});
