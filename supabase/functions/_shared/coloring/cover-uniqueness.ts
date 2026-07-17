// Cover uniqueness gate (owner law 2026-07-18, permanent).
//
// Prevents two coloring books from shipping with visually near-identical
// covers (the "Cute Sea Animals" ≈ "Ocean Friends" class of defect). Every
// accepted cover stores a 64-bit dHash fingerprint in
// metadata.coloring_cover.visual_fingerprint; new covers are compared
// against every other coloring-book cover's fingerprint and rejected when
// the Hamming distance is below the duplicate threshold.
//
// dHash chosen over pHash because it's:
//   1. Cheap to compute (single grayscale + 72 comparisons — no DCT).
//   2. Robust to palette / brightness shifts but still discriminating on
//      composition, which is exactly the axis we care about.
//   3. Fully deterministic, no ML dependency.

// @ts-nocheck  Deno edge runtime

const DUPLICATE_HAMMING_THRESHOLD = 12; // ≤ 12 bits difference ⇒ duplicate

export interface CoverFingerprint {
  algo: "dhash64_v1";
  hash: string; // 16 hex chars = 64 bits
  computed_at: string;
}

export async function computeCoverFingerprint(bytes: Uint8Array): Promise<CoverFingerprint> {
  const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
  const img = await Image.decode(bytes);
  const W = 9, H = 8;
  const sx = img.width / W;
  const sy = img.height / H;
  const gray: number[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = Math.min(img.width - 1, Math.max(0, Math.floor((x + 0.5) * sx)));
      const py = Math.min(img.height - 1, Math.max(0, Math.floor((y + 0.5) * sy)));
      // imagescript coordinates are 1-indexed
      const p = img.getPixelAt(px + 1, py + 1);
      const r = (p >>> 24) & 0xff;
      const g = (p >>> 16) & 0xff;
      const b = (p >>> 8) & 0xff;
      gray[y * W + x] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
    }
  }
  let bits = "";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits += gray[y * W + x] < gray[y * W + x + 1] ? "1" : "0";
    }
  }
  // 64 bits → 16 hex chars
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return { algo: "dhash64_v1", hash: hex, computed_at: new Date().toISOString() };
}

function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    // popcount for a nibble
    d += ((x >> 3) & 1) + ((x >> 2) & 1) + ((x >> 1) & 1) + (x & 1);
  }
  return d;
}

export interface DuplicateHit {
  id: string;
  title: string;
  cover_url: string | null;
  distance: number;
}

/**
 * Compare the candidate fingerprint against every other coloring book's
 * stored fingerprint. Returns the closest match if it's below the
 * duplicate threshold, otherwise `null` (unique enough to accept).
 *
 * `excludeEbookId` prevents a book's own prior cover version from
 * self-tripping the gate on regenerations.
 */
export async function findDuplicateCover(
  db: any,
  fp: CoverFingerprint,
  excludeEbookId: string,
): Promise<DuplicateHit | null> {
  const { data, error } = await db
    .from("ebooks_kids")
    .select("id, title, cover_url, metadata")
    .eq("book_type", "coloring_book")
    .not("id", "eq", excludeEbookId)
    .not("cover_url", "is", null);
  if (error) throw new Error(`fingerprint_query_failed:${error.message}`);
  let best: DuplicateHit | null = null;
  for (const row of (data ?? [])) {
    const otherFp = row?.metadata?.coloring_cover?.visual_fingerprint;
    if (!otherFp || otherFp.algo !== fp.algo || typeof otherFp.hash !== "string") continue;
    const d = hammingHex(fp.hash, otherFp.hash);
    if (!best || d < best.distance) {
      best = { id: row.id, title: row.title, cover_url: row.cover_url, distance: d };
    }
  }
  if (best && best.distance <= DUPLICATE_HAMMING_THRESHOLD) return best;
  return null;
}

export { DUPLICATE_HAMMING_THRESHOLD };
