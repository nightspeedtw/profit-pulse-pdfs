import { describe, expect, it } from "vitest";
import { assertColoringTrim, COLORING_TRIM } from "../../supabase/functions/_shared/coloring/trim-lock";

describe("assertColoringTrim", () => {
  it("passes exact PDF page geometry", () => {
    const r = assertColoringTrim("pdf_page", 612, 792);
    expect(r.pass).toBe(true);
  });
  it("rejects wrong PDF page geometry", () => {
    const r = assertColoringTrim("pdf_page", 612, 612);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/pdf_page_trim_mismatch/);
  });
  it("passes native 1600x2071 cover raster", () => {
    const r = assertColoringTrim("cover", 1600, 2071);
    expect(r.pass).toBe(true);
  });
  it("rejects square cover raster", () => {
    const r = assertColoringTrim("cover", 1600, 1600);
    expect(r.pass).toBe(false);
  });
  it("passes 600x776 thumbnail canvas", () => {
    const r = assertColoringTrim("thumbnail", COLORING_TRIM.thumbnailPx.width, COLORING_TRIM.thumbnailPx.height);
    expect(r.pass).toBe(true);
  });
  it("rejects landscape thumbnail", () => {
    const r = assertColoringTrim("thumbnail", 776, 600);
    expect(r.pass).toBe(false);
  });
});
