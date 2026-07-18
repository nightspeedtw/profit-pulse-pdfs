// Pre-publish HARD GATE — cover-aspect-mismatch.
//
// Every downstream container that renders a cover with baked title MUST
// match the native asset ratio for the book's trim profile. Phase A
// (2026-07-19): profile is required — the gate no longer assumes 8.5:11.
// Legacy call sites without a profile still resolve to `letter_portrait`
// via the default arg for back-compat; new call sites MUST pass the
// resolved profile key.

import { TRIM_PROFILES, type TrimProfileKey } from "./trim-lock.ts";

// Kept for back-compat with existing imports/tests. Represent the letter
// profile's native cover dims.
export const COLORING_COVER_NATIVE_W = TRIM_PROFILES.letter_portrait.coverPx.width;
export const COLORING_COVER_NATIVE_H = TRIM_PROFILES.letter_portrait.coverPx.height;
export const COLORING_COVER_NATIVE_RATIO = COLORING_COVER_NATIVE_W / COLORING_COVER_NATIVE_H;
export const COLORING_COVER_RATIO_TOLERANCE = TRIM_PROFILES.letter_portrait.toleranceRatio;

export interface CoverAspectGateResult {
  pass: boolean;
  profile: TrimProfileKey;
  actual_ratio: number | null;
  expected_ratio: number;
  width: number | null;
  height: number | null;
  reason?: string;
}

export function probeImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length >= 24 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
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

export function checkCoverAspect(
  bytes: Uint8Array,
  profileKey: TrimProfileKey = "letter_portrait",
): CoverAspectGateResult {
  const profile = TRIM_PROFILES[profileKey];
  const expected = profile.coverPx.width / profile.coverPx.height;
  const tol = profile.toleranceRatio;
  const size = probeImageSize(bytes);
  if (!size) {
    return {
      pass: false, profile: profileKey,
      actual_ratio: null, expected_ratio: expected,
      width: null, height: null, reason: "unrecognised_image_header",
    };
  }
  const ratio = size.w / size.h;
  const delta = Math.abs(ratio - expected);
  if (delta > tol) {
    return {
      pass: false, profile: profileKey,
      actual_ratio: ratio, expected_ratio: expected,
      width: size.w, height: size.h,
      reason: `cover_aspect_mismatch[${profileKey}]: ${size.w}x${size.h} (w/h=${ratio.toFixed(4)}) differs from ${profile.aspectLabel} (${expected.toFixed(4)}) by ${(delta * 100).toFixed(2)}% > ${(tol * 100).toFixed(1)}%`,
    };
  }
  return {
    pass: true, profile: profileKey,
    actual_ratio: ratio, expected_ratio: expected,
    width: size.w, height: size.h,
  };
}
