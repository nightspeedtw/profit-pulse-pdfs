import { describe, it, expect } from "vitest";
import {
  estimateJsonBytes,
  sanitizeAttemptForPersist,
  sanitizeAttemptsForPersist,
  sanitizeMetadataPatchForPersist,
} from "../../supabase/functions/_shared/coloring/metadata-bloat-guard.ts";

describe("metadata_never_toasts: cover attempt persistence guard", () => {
  it("strips raw image bytes and caps cover attempt history", () => {
    const attempts = Array.from({ length: 9 }, (_, i) => ({
      attempt: i + 1,
      status: "text_rejected",
      _rawBytes: new Uint8Array(2_000_000),
      checks: {
        transcription: {
          reason: "x".repeat(2_000),
          transcribed_raw: "TITLE ".repeat(500),
        },
      },
    }));

    const clean = sanitizeAttemptsForPersist(attempts) as any[];
    expect(clean).toHaveLength(5);
    expect(clean[0].attempt).toBe(5);
    expect(JSON.stringify(clean)).not.toContain("_rawBytes");
    expect(estimateJsonBytes(clean)).toBeLessThan(20_000);
  });

  it("strips nested self-art bytes before metadata writes", () => {
    const clean = sanitizeAttemptForPersist({
      status: "accepted_self_art_retry_ceiling",
      checks: {
        self_art: {
          bytes: new Uint8Array(1_500_000),
          heroes_used: [{ page: 1, source_url: "https://asset/page-1.png" }],
        },
      },
    }) as any;

    expect(clean.checks.self_art.bytes).toBeUndefined();
    expect(clean.checks.self_art.heroes_used[0].page).toBe(1);
    expect(estimateJsonBytes(clean)).toBeLessThan(5_000);
  });

  it("sanitizes whole metadata patches, including accepted cover evidence", () => {
    const patch = sanitizeMetadataPatchForPersist({
      coloring_cover_single_attempt: { _rawBytes: new Uint8Array(1000), reason: "r".repeat(1000) },
      coloring_cover_ideogram_attempts: Array.from({ length: 7 }, (_, i) => ({ attempt: i, rawBytes: new Uint8Array(1000) })),
      coloring_cover: { evidence: { self_art: { bytes: new Uint8Array(1000) } } },
    }) as any;

    expect(patch.coloring_cover_ideogram_attempts).toHaveLength(5);
    expect(patch.coloring_cover.evidence.self_art.bytes).toBeUndefined();
    expect(JSON.stringify(patch)).not.toContain("0,0,0");
  });
});