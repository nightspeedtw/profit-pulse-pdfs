// Metadata Bloat Guard — pure helper, safe to import from edge functions and Vitest.
//
// Defect class: persistence_contract_bug / metadata_never_toasts.
// Raw PNG bytes, RGBA arrays, base64 payloads, and full OCR transcripts must
// never be persisted inside ebooks_kids.metadata. Assets live in Storage;
// metadata keeps compact identity/evidence only.

export const MAX_ATTEMPT_HISTORY = 5;
const MAX_STRING = 2_000;
const MAX_REASON = 360;
const MAX_TRANSCRIPT = 500;

const BYTE_KEYS = new Set([
  "bytes", "_rawBytes", "rawBytes", "finalBytes", "artOnlyBytes", "overlayBytes",
  "png", "image", "image_bytes", "rgba", "buffer", "arrayBuffer", "base64", "image_base64",
]);

function isByteLike(v: unknown): boolean {
  return typeof Uint8Array !== "undefined" && v instanceof Uint8Array;
}

function trimString(key: string, value: string): string {
  const lower = key.toLowerCase();
  const limit = lower.includes("reason") || lower.includes("error")
    ? MAX_REASON
    : lower.includes("transcrib") || lower.includes("detected_text")
      ? MAX_TRANSCRIPT
      : MAX_STRING;
  if (/^data:image\//i.test(value)) return `[stripped_data_url:${value.length} chars]`;
  return value.length > limit ? value.slice(0, limit) : value;
}

export function sanitizeMetadataValue(value: unknown, key = "", depth = 0): unknown {
  if (value == null) return value;
  if (isByteLike(value)) return `[stripped_bytes:${(value as Uint8Array).byteLength}]`;
  if (typeof value === "string") return trimString(key, value);
  if (typeof value !== "object") return value;
  if (depth > 8) return "[stripped_deep_metadata]";
  if (Array.isArray(value)) return value.map((v) => sanitizeMetadataValue(v, key, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (BYTE_KEYS.has(k)) {
      continue;
    }
    out[k] = sanitizeMetadataValue(v, k, depth + 1);
  }
  return out;
}

export function sanitizeAttemptForPersist(a: unknown): unknown {
  return sanitizeMetadataValue(a, "attempt");
}

export function sanitizeAttemptsForPersist(list: unknown): unknown[] {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeAttemptForPersist).slice(-MAX_ATTEMPT_HISTORY);
}

export function sanitizeMetadataPatchForPersist(patch: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === "coloring_cover_ideogram_attempts" && Array.isArray(v)) {
      clean[k] = sanitizeAttemptsForPersist(v);
    } else if (k === "coloring_cover_single_attempt" || k.endsWith("_attempt")) {
      clean[k] = sanitizeAttemptForPersist(v);
    } else {
      clean[k] = sanitizeMetadataValue(v, k);
    }
  }
  return clean;
}

export function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}