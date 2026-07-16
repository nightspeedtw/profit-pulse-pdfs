// Format-agnostic verify-at-birth for coloring-book pages.
// FAL Flux Schnell returns JPEG by default and does not honor output_format;
// other providers may return PNG or WebP. Detect from magic bytes so the
// gate is provider-agnostic and the stored asset carries the correct
// extension + Content-Type for downstream PDF assembly.

export type ImageKind = "png" | "jpeg" | "webp";

export const IMAGE_MIME: Record<ImageKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const IMAGE_EXT: Record<ImageKind, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
// WebP = "RIFF....WEBP"
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

export function detectImageKind(bytes: Uint8Array): ImageKind {
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (startsWith(bytes, JPEG_MAGIC)) return "jpeg";
  if (startsWith(bytes, RIFF_MAGIC) && startsWith(bytes, WEBP_MAGIC, 8)) return "webp";
  throw new Error("verify_at_birth: bytes are not PNG/JPEG/WebP (magic mismatch)");
}

export interface VerifiedImage {
  kind: ImageKind;
  mime: string;
  ext: string;
}

export function verifyImageAtBirth(bytes: Uint8Array, page: number, minBytes = 8_000): VerifiedImage {
  if (bytes.length < minBytes) {
    throw new Error(`verify_at_birth: page ${page} bytes=${bytes.length} < min ${minBytes}`);
  }
  let kind: ImageKind;
  try {
    kind = detectImageKind(bytes);
  } catch (e: any) {
    throw new Error(`verify_at_birth: page ${page} ${e?.message ?? String(e)}`);
  }
  return { kind, mime: IMAGE_MIME[kind], ext: IMAGE_EXT[kind] };
}
