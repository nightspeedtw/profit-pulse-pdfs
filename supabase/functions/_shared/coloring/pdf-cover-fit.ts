// Pure fit-CONTAIN placement for coloring cover on PDF page.
//
// Permanent rule (round_2 CLASS: cover-crop-v3): the assembler MUST use
// fit-CONTAIN (Math.min scale, centered, on white letterbox) — never
// fit-COVER (Math.max) — for placing the cover raster on the 612×792pt
// coloring PDF page. fit-COVER mathematically guarantees overflow when the
// raster ratio isn't bit-exact with the page ratio, which clips the baked
// title and edge characters.
//
// The upstream aspect gate (checkCoverAspect) keeps the raster within 1%
// of 8.5:11, so the letterbox from fit-CONTAIN is ≤ ~3pt and invisible in
// print — while any future drift is bounded to letterbox (safe) instead
// of overflow (crops title).

export interface CoverFitPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

export function fitContainCover(
  imageW: number,
  imageH: number,
  pageW: number,
  pageH: number,
): CoverFitPlacement {
  if (imageW <= 0 || imageH <= 0 || pageW <= 0 || pageH <= 0) {
    throw new Error(`fitContainCover: invalid dims ${imageW}x${imageH} on ${pageW}x${pageH}`);
  }
  const scale = Math.min(pageW / imageW, pageH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return {
    x: (pageW - w) / 2,
    y: (pageH - h) / 2,
    w,
    h,
    scale,
  };
}
