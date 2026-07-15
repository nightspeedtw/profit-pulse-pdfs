// Phase 7 regression tests — pdf-metadata derivation from actual bytes.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countPdfPages,
  pdfVersion,
  deriveFinalPdfMetadata,
  assertDerivedMatchesPlan,
  PdfMetadataError,
} from "../../supabase/functions/_shared/pdf-metadata.ts";


// Minimal synthetic PDF-ish buffer containing N `/Type /Page` markers plus a
// header. The derive functions only inspect the header + these markers, so
// this is enough to exercise the metadata contract deterministically without
// pulling pdf-lib into the test runner.
function synthPdf(n: number, version = "1.4"): Uint8Array {
  const parts = [`%PDF-${version}\n%\xE2\xE3\xCF\xD3\n`];
  for (let i = 0; i < n; i++) {
    parts.push(`${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`);
  }
  parts.push("%%EOF\n");
  return new TextEncoder().encode(parts.join(""));
}

describe("pdf-metadata (Phase 7)", () => {
  it("counts pages via /Type /Page markers (not /Pages)", () => {
    const bytes = synthPdf(5);
    // Also inject a /Type /Pages catalog to prove the regex excludes it.
    const withPages = new TextEncoder().encode(
      new TextDecoder("latin1").decode(bytes) +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 5 >>\nendobj\n"
    );
    expect(countPdfPages(withPages)).toBe(5);
  });

  it("extracts the PDF version from the header", () => {
    expect(pdfVersion(synthPdf(1, "1.7"))).toBe("1.7");
  });

  it("rejects non-PDF headers", () => {
    expect(() => pdfVersion(new TextEncoder().encode("not a pdf"))).toThrow(PdfMetadataError);
  });

  it("deriveFinalPdfMetadata returns page_count/byte_size/sha256/version", async () => {
    const bytes = synthPdf(18);
    const meta = await deriveFinalPdfMetadata(bytes);
    expect(meta.page_count).toBe(18);
    expect(meta.pdf_byte_size).toBe(bytes.length);
    expect(meta.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.pdf_version).toBe("1.4");
  });

  it("refuses to persist a zero-page PDF", async () => {
    await expect(deriveFinalPdfMetadata(synthPdf(0))).rejects.toBeInstanceOf(PdfMetadataError);
  });

  it("refuses empty bytes", async () => {
    await expect(deriveFinalPdfMetadata(new Uint8Array())).rejects.toBeInstanceOf(PdfMetadataError);
  });

  it("assertDerivedMatchesPlan throws PDF_METADATA_DRIFT on mismatch", async () => {
    const meta = await deriveFinalPdfMetadata(synthPdf(18));
    expect(() => assertDerivedMatchesPlan(meta, { expected_page_count: 18 })).not.toThrow();
    try {
      assertDerivedMatchesPlan(meta, { expected_page_count: 19 });
      throw new Error("expected drift");
    } catch (e) {
      expect(e).toBeInstanceOf(PdfMetadataError);
      expect((e as PdfMetadataError).code).toBe("PDF_METADATA_DRIFT");
    }
  });

  it("sha256 is deterministic for identical bytes", async () => {
    const a = await deriveFinalPdfMetadata(synthPdf(3));
    const b = await deriveFinalPdfMetadata(synthPdf(3));
    expect(a.pdf_sha256).toBe(b.pdf_sha256);
  });

  // REGRESSION (2026-07-15, fixture book 2578ed8c stuck at pdf_pages_6):
  // pdf-lib's default `save()` uses object streams, hiding every `/Type /Page`
  // marker inside a compressed stream. countPdfPages() would then return 0
  // and Phase-7 refused to persist the final PDF forever. The fix is (a)
  // finalizePicturePdf saves with `useObjectStreams: false`, and (b) the
  // parser falls back to the root `/Type /Pages … /Count N` catalog entry
  // when no visible /Type /Page markers are present.
  it("falls back to /Type /Pages /Count when object streams hide page objects", () => {
    const bytes = new TextEncoder().encode(
      `%PDF-1.7\n%\xE2\xE3\xCF\xD3\n` +
      // A pages catalog with /Count — but no visible /Type /Page objects
      // (as if they were compressed inside an object stream).
      `2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 34 >>\nendobj\n` +
      `%%EOF\n`
    );
    expect(countPdfPages(bytes)).toBe(34);
  });

  it("finalize derive on a 34-page in-memory PDF (via /Count fallback) returns 34", async () => {
    const bytes = new TextEncoder().encode(
      `%PDF-1.7\n%\xE2\xE3\xCF\xD3\n` +
      `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 34 >>\nendobj\n%%EOF\n`
    );
    const meta = await deriveFinalPdfMetadata(bytes);
    expect(meta.page_count).toBe(34);
  });

  // ARCHITECTURAL REGRESSION: deriveFinalPdfMetadata (which enforces the
  // "refuse to persist a zero-page PDF" gate) must ONLY be called on the
  // finalize lane of kids-build-picture-pdf. Invoking it per-stage against
  // the in-progress artifact would trigger a hard failure every batch.
  it("kids-build-picture-pdf calls deriveFinalPdfMetadata only in the finalize branch", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/kids-build-picture-pdf/index.ts"),
      "utf8",
    );
    const lines = src.split("\n");
    const finalizeStart = lines.findIndex((l) => l.includes("} else if (pos.lane === 'finalize')"));
    const interiorStart = lines.findIndex((l, i) => i > finalizeStart && l.trim().startsWith("} else {"));
    expect(finalizeStart).toBeGreaterThan(0);
    expect(interiorStart).toBeGreaterThan(finalizeStart);
    const callLine = lines.findIndex((l) => l.includes("deriveFinalPdfMetadata("));
    expect(callLine).toBeGreaterThan(finalizeStart);
    expect(callLine).toBeLessThan(interiorStart);
    // And no other call site outside the finalize block.
    const allCallLines = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /deriveFinalPdfMetadata\s*\(/.test(l));
    expect(allCallLines).toHaveLength(1);
  });
});

