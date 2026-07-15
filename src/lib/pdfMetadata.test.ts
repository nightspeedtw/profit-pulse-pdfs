// Phase 7 regression tests — pdf-metadata derivation from actual bytes.

import { describe, it, expect } from "vitest";
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
});
