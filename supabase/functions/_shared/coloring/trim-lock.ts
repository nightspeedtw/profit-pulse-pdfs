// Coloring-book trim lock — 8.5" × 11" US Letter portrait, EVERYWHERE.
//
// Owner law: cover master, interior page rasters, and every PDF page in a
// coloring book MUST be 8.5×11 portrait. Any drift is a hard error; the
// autopilot must not publish a book that mixes trim sizes.
//
// Canonical dimensions:
//   * PDF page geometry: 612×792 pt (exact 8.5×11 @ 72dpi).
//   * Cover master raster: 1600×2071 px (ratio 0.7726, within tolerance).
//   * Interior page raster: 1600×2071 px (same as cover, so the assembly
//     never has to remap aspect between cover and interiors).
//   * Thumbnail: 600×776 px — same 8.5:11 ratio, sized for retina store cards.
//
// Do NOT introduce a second trim size for coloring books.

export const COLORING_TRIM = {
  widthIn: 8.5,
  heightIn: 11,
  ratio: 8.5 / 11, // ≈ 0.77272
  toleranceRatio: 0.01, // ±1% aspect drift tolerance
  pdf: { widthPt: 612, heightPt: 792 },
  coverPx: { width: 1600, height: 2071 },
  interiorPx: { width: 1600, height: 2071 },
  thumbnailPx: { width: 600, height: 776 },
} as const;

export type ColoringTrimKind = "cover" | "interior" | "thumbnail" | "pdf_page";

export interface ColoringTrimAssertion {
  pass: boolean;
  kind: ColoringTrimKind;
  actual: { width: number; height: number; ratio: number };
  expected: { width: number; height: number; ratio: number };
  reason?: string;
}

/**
 * Assert a raster/PDF-page matches the coloring trim for the given kind.
 * Returns a structured result; the caller decides whether to hard-fail.
 */
export function assertColoringTrim(
  kind: ColoringTrimKind,
  width: number,
  height: number,
): ColoringTrimAssertion {
  const spec = kind === "pdf_page"
    ? { width: COLORING_TRIM.pdf.widthPt, height: COLORING_TRIM.pdf.heightPt }
    : kind === "interior"
    ? COLORING_TRIM.interiorPx
    : kind === "thumbnail"
    ? COLORING_TRIM.thumbnailPx
    : COLORING_TRIM.coverPx;
  const expectedRatio = spec.width / spec.height;
  const actualRatio = width / height;
  const ratioDelta = Math.abs(actualRatio - expectedRatio);
  // For pdf_page we require EXACT dimensions (integer points); for rasters
  // we require the ratio to match to within tolerance so upstream fitting
  // never re-crops the baked title.
  if (kind === "pdf_page") {
    if (width !== spec.width || height !== spec.height) {
      return {
        pass: false, kind,
        actual: { width, height, ratio: actualRatio },
        expected: { width: spec.width, height: spec.height, ratio: expectedRatio },
        reason: `pdf_page_trim_mismatch: ${width}x${height}pt != 612x792pt`,
      };
    }
  } else if (ratioDelta > COLORING_TRIM.toleranceRatio) {
    return {
      pass: false, kind,
      actual: { width, height, ratio: actualRatio },
      expected: { width: spec.width, height: spec.height, ratio: expectedRatio },
      reason: `${kind}_trim_mismatch: ${width}x${height} (w/h=${actualRatio.toFixed(4)}) differs from 8.5:11 (${expectedRatio.toFixed(4)}) by ${(ratioDelta * 100).toFixed(2)}%`,
    };
  }
  return {
    pass: true, kind,
    actual: { width, height, ratio: actualRatio },
    expected: { width: spec.width, height: spec.height, ratio: expectedRatio },
  };
}
