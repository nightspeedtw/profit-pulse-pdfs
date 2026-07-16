import { describe, expect, it } from "vitest";
import {
  detectImageKind,
  verifyImageAtBirth,
} from "../../supabase/functions/_shared/coloring/image-kind.ts";

function bytesOf(prefix: number[], padTo = 10_000): Uint8Array {
  const out = new Uint8Array(padTo);
  out.set(prefix, 0);
  return out;
}

describe("verify_at_birth detects real image formats", () => {
  it("accepts PNG magic", () => {
    const b = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectImageKind(b)).toBe("png");
    expect(verifyImageAtBirth(b, 1).kind).toBe("png");
  });

  it("accepts JPEG magic (FAL Flux Schnell default output)", () => {
    const b = bytesOf([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectImageKind(b)).toBe("jpeg");
    const v = verifyImageAtBirth(b, 2);
    expect(v.kind).toBe("jpeg");
    expect(v.mime).toBe("image/jpeg");
    expect(v.ext).toBe("jpg");
  });

  it("accepts WebP magic (RIFF...WEBP)", () => {
    const b = new Uint8Array(10_000);
    b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0);
    expect(detectImageKind(b)).toBe("webp");
    expect(verifyImageAtBirth(b, 3).kind).toBe("webp");
  });

  it("rejects unknown magic", () => {
    const b = bytesOf([0x00, 0x01, 0x02, 0x03]);
    expect(() => verifyImageAtBirth(b, 4)).toThrow(/magic mismatch/);
  });

  it("rejects undersized bytes (blank/1-pixel outputs)", () => {
    const b = new Uint8Array(100);
    b.set([0x89, 0x50, 0x4e, 0x47], 0);
    expect(() => verifyImageAtBirth(b, 5)).toThrow(/< min/);
  });
});
