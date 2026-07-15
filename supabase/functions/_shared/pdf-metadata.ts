// Phase 7 — Derive PDF metadata from the ACTUAL final bytes.
//
// Canonical rule (SecretPDF production suite → pdf-integrity):
// `page_count`, `pdf_byte_size`, and `pdf_sha256` on `ebooks_kids` MUST be
// computed from the exact bytes uploaded to the ebook-pdfs bucket — never
// from planning-stage arithmetic, never from an earlier draft, never from
// a spread count that was decided before finalize.
//
// If the derived metadata disagrees with the planned/expected values, the
// finalize path MUST throw and refuse to persist. That mismatch is a
// `pdf_metadata_drift` defect and preserves evidence for the P0 workflow.

export interface DerivedPdfMetadata {
  page_count: number;
  pdf_byte_size: number;
  pdf_sha256: string;
  pdf_version: string;         // e.g. "1.4"
  derived_at: string;          // ISO
}

export class PdfMetadataError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PdfMetadataError";
    this.code = code;
    this.details = details;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Count PDF pages by scanning for /Type /Page objects (not /Pages).
 * Robust for pdf-lib output: pages are always `/Type /Page` objects.
 */
export function countPdfPages(bytes: Uint8Array): number {
  // Fast ASCII scan — PDF structural keywords are always ASCII.
  const s = new TextDecoder("latin1").decode(bytes);
  // Match "/Type" then whitespace then "/Page" NOT followed by 's' or a letter.
  const rx = /\/Type\s*\/Page(?![sA-Za-z])/g;
  let n = 0;
  while (rx.exec(s) !== null) n++;
  return n;
}

export function pdfVersion(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new PdfMetadataError("PDF_TOO_SHORT", "buffer too short");
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  const m = /^%PDF-(\d+\.\d+)/.exec(head);
  if (!m) throw new PdfMetadataError("PDF_HEADER_MISSING", `bad header: ${head}`);
  return m[1];
}

/**
 * Derive canonical final-PDF metadata from raw bytes. Throws
 * PdfMetadataError on any structural problem (missing header, zero pages).
 */
export async function deriveFinalPdfMetadata(bytes: Uint8Array): Promise<DerivedPdfMetadata> {
  if (!(bytes && bytes.length > 0)) throw new PdfMetadataError("EMPTY_BYTES", "no PDF bytes");
  const version = pdfVersion(bytes);
  const page_count = countPdfPages(bytes);
  if (page_count < 1) {
    throw new PdfMetadataError("PDF_NO_PAGES", "derived page_count is 0 — refusing to persist");
  }
  const pdf_sha256 = await sha256Hex(bytes);
  return {
    page_count,
    pdf_byte_size: bytes.length,
    pdf_sha256,
    pdf_version: version,
    derived_at: new Date().toISOString(),
  };
}

/**
 * Assert derived metadata matches the planned expectations. On mismatch
 * throws PdfMetadataError with code `PDF_METADATA_DRIFT` — the caller MUST
 * treat this as a hard finalize failure (never persist the drifted values,
 * never publish, never mark final_pdf_ready).
 */
export function assertDerivedMatchesPlan(
  derived: DerivedPdfMetadata,
  plan: { expected_page_count: number },
): void {
  if (derived.page_count !== plan.expected_page_count) {
    throw new PdfMetadataError(
      "PDF_METADATA_DRIFT",
      `page_count drift: expected ${plan.expected_page_count}, derived ${derived.page_count}`,
      { derived, plan },
    );
  }
}
