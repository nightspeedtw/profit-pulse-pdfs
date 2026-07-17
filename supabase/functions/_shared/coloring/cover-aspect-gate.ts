// Pre-publish HARD GATE — round_2 CLASS: cover-aspect-mismatch.
//
// Symptom: a coloring cover with baked title/art displays or embeds into a
// container whose aspect ratio differs from the asset's native ratio, so
// object-cover / fit-COVER clips the baked title and edge characters.
//
// Rule: every downstream container that renders a cover with baked title
// MUST match the native asset ratio. Coloring covers ship at 1600x2071
// (8.5:11 portrait, ratio ≈ 0.7727). We enforce this at publish time by
// probing the asset dimensions and rejecting anything outside a tight
// tolerance. Fix the generator or the container — never lower this gate.

export const COLORING_COVER_NATIVE_W = 1600;
export const COLORING_COVER_NATIVE_H = 2071;
export const COLORING_COVER_NATIVE_RATIO = COLORING_COVER_NATIVE_W / COLORING_COVER_NATIVE_H; // 0.7726
export const COLORING_COVER_RATIO_TOLERANCE = 0.01; // ±1% w/h

export interface CoverAspectGateResult {
  pass: boolean;
  actual_ratio: number | null;
  expected_ratio: number;
  width: number | null;
  height: number | null;
  reason?: string;
}

/**
 * Probe a PNG/JPEG byte stream and return width/height without a full decode.
 * Supports the two formats the coloring pipeline emits.
 */
export function probeImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte sig + IHDR (13 bytes) with width/height at offset 16/20.
  if (bytes.length >= 24 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // JPEG: scan SOF markers.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        return { w, h };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function checkCoverAspect(bytes: Uint8Array): CoverAspectGateResult {
  const size = probeImageSize(bytes);
  if (!size) {
    return {
      pass: false, actual_ratio: null, expected_ratio: COLORING_COVER_NATIVE_RATIO,
      width: null, height: null, reason: "unrecognised_image_header",
    };
  }
  const ratio = size.w / size.h;
  const delta = Math.abs(ratio - COLORING_COVER_NATIVE_RATIO);
  if (delta > COLORING_COVER_RATIO_TOLERANCE) {
    return {
      pass: false, actual_ratio: ratio, expected_ratio: COLORING_COVER_NATIVE_RATIO,
      width: size.w, height: size.h,
      reason: `cover_aspect_mismatch: ${size.w}x${size.h} (w/h=${ratio.toFixed(4)}) differs from native ${COLORING_COVER_NATIVE_W}x${COLORING_COVER_NATIVE_H} (w/h=${COLORING_COVER_NATIVE_RATIO.toFixed(4)}) by ${(delta * 100).toFixed(2)}% > ${(COLORING_COVER_RATIO_TOLERANCE * 100).toFixed(1)}%`,
    };
  }
  return {
    pass: true, actual_ratio: ratio, expected_ratio: COLORING_COVER_NATIVE_RATIO,
    width: size.w, height: size.h,
  };
}
