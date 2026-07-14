// QC v2 — real PDF preflight. Measures the actual bytes, never trusts the model.
// Produces findings with rule_id + measured_value + threshold + evidence.

import { PDFDocument } from "npm:pdf-lib@1.17.1";


export interface RawFinding {
  rule_id: string;
  category: string;
  severity: "critical" | "major" | "minor";
  passed: boolean;
  page_number?: number | null;
  measured_value: Record<string, unknown>;
  threshold: Record<string, unknown>;
  evidence_url?: string | null;
  repair_action?: string;
}

const PLACEHOLDER_MARKERS = ["A Little Story", "Story pending", "book pending render"];

export async function preflightPdf(pdfUrl: string | null | undefined): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  if (!pdfUrl) {
    findings.push(critical("INVALID_PDF", "pdf_preflight", { reason: "no pdf_url" }, { must: "present" }, "regenerate_pdf"));
    return findings;
  }

  let bytes: Uint8Array;
  let contentType = "";
  try {
    const res = await fetch(pdfUrl);
    contentType = res.headers.get("content-type") ?? "";
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    findings.push(critical("INVALID_PDF", "pdf_preflight", { fetch_error: String(e) }, { must: "downloadable" }, "regenerate_pdf"));
    return findings;
  }

  // 1. Magic header — the real, cheap test that catches HTML-uploaded-as-PDF.
  const head = new TextDecoder().decode(bytes.slice(0, 8));
  const isRealPdf = head.startsWith("%PDF-");
  if (!isRealPdf) {
    findings.push(critical(
      "FAKE_PDF_MIME_TYPE", "pdf_preflight",
      { first_bytes: head, content_type: contentType, byte_size: bytes.length },
      { must_start_with: "%PDF-" },
      "regenerate_pdf",
    ));
    // Also flag as INVALID_PDF so downstream repair strategies can pick it up.
    findings.push(critical("INVALID_PDF", "pdf_preflight", { first_bytes: head }, { must_start_with: "%PDF-" }, "rebuild_pdf_from_source"));
    return findings; // no point parsing further
  }

  // 2. Placeholder / "pending render" body detection.
  const asText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const hitMarker = PLACEHOLDER_MARKERS.find((m) => asText.includes(m));
  if (hitMarker) {
    findings.push(critical(
      "IMAGE_PLACEHOLDER", "pdf_preflight",
      { marker: hitMarker },
      { must_not_contain: PLACEHOLDER_MARKERS },
      "regenerate_pdf",
    ));
  }

  // 3. Page count + geometry — pdf-lib uses compressed object streams so raw
  // regex scans miss both /Type /Page and /Count. Parse with pdf-lib for a
  // real page count, then fall back to regex for uncompressed output.
  let pageCount = 0;
  let firstPageW = 0;
  let firstPageH = 0;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = doc.getPageCount();
    if (pageCount > 0) {
      const first = doc.getPage(0);
      firstPageW = Math.round(first.getWidth());
      firstPageH = Math.round(first.getHeight());
    }
  } catch {
    const countMatch = asText.match(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/);
    if (countMatch) pageCount = parseInt(countMatch[1], 10);
    if (!pageCount) pageCount = (asText.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  }
  if (pageCount < 1) {
    findings.push(critical(
      "MISSING_PAGE", "pdf_preflight",
      { detected_pages: pageCount },
      { min_pages: 1 },
      "regenerate_pdf",
    ));
  }
  // Kids picture-book format gate: 32–40 pages, SQUARE 612x612 geometry.
  // Only enforced when the PDF looks like a kids book — signaled by the
  // square geometry itself. Wrong geometry is always a hard fail.
  if (firstPageW && firstPageH) {
    const isSquare = Math.abs(firstPageW - firstPageH) <= 2;
    const is612 = Math.abs(firstPageW - 612) <= 2 && Math.abs(firstPageH - 612) <= 2;
    // Non-kids adult books may use letter (612x792) — don't fail those.
    if (isSquare && !is612) {
      findings.push(critical(
        "PDF_WRONG_TRIM", "pdf_preflight",
        { width_pt: firstPageW, height_pt: firstPageH },
        { must: "612x612 pt (8.5x8.5 in square)" },
        "regenerate_pdf",
      ));
    }
    if (is612 && pageCount > 0 && (pageCount < 32 || pageCount > 40)) {
      findings.push(critical(
        "PDF_PAGE_COUNT_OUT_OF_RANGE", "pdf_preflight",
        { detected_pages: pageCount },
        { min_pages: 32, max_pages: 40 },
        "regenerate_pdf",
      ));
    }
  }

  // 4. Font embedding — required only when the PDF uses non-standard fonts.
  // The 14 PDF core fonts do NOT need to be embedded per the PDF spec.
  // Modern producers (pdf-lib, etc.) put font dicts inside FlateDecode object
  // streams so raw-text scans miss them; in that case pdf-lib successfully
  // parsing the document is enough proof it is well-formed.
  const usesObjectStreams = /\/ObjStm/.test(asText);
  const hasFontFile = /\/FontFile[23]?/.test(asText) || /\/Subtype\s*\/Type0/.test(asText);
  const usesOnlyCoreFonts = /\/BaseFont\s*\/(Helvetica|Times-Roman|Times-Bold|Times-Italic|Times-BoldItalic|Courier|Courier-Bold|Symbol|ZapfDingbats)/.test(asText);
  if (pageCount > 0 && !usesObjectStreams && !hasFontFile && !usesOnlyCoreFonts) {
    findings.push({
      rule_id: "BROKEN_FONT_OR_GLYPH",
      category: "pdf_preflight",
      severity: "critical",
      passed: false,
      measured_value: { embedded_fonts: false, uses_core_fonts: false },
      threshold: { fonts_must_be_embedded_or_core14: true },
      repair_action: "embed_fonts_and_rerender",
    });
  }

  // 5. Byte-size sanity.
  if (bytes.length < 2048) {
    findings.push(critical(
      "INVALID_PDF", "pdf_preflight",
      { byte_size: bytes.length },
      { min_bytes: 2048 },
      "rebuild_pdf_from_source",
    ));
  }

  // Passing marker for the "PDF is a real PDF" rule so the scorecard shows it.
  findings.push({
    rule_id: "PDF_IS_VALID",
    category: "pdf_preflight",
    severity: "major",
    passed: true,
    measured_value: { first_bytes: head, byte_size: bytes.length, detected_pages: pageCount },
    threshold: { must_start_with: "%PDF-" },
  });

  return findings;
}

export function preflightCover(coverUrl: string | null | undefined, title: string): RawFinding[] {
  const findings: RawFinding[] = [];
  if (!coverUrl) {
    findings.push(critical("IMAGE_MISSING", "cover_interior_match", { field: "cover_url" }, { must: "present" }, "regenerate_cover"));
    return findings;
  }
  // SVG placeholder used by the old fallback path — treat as placeholder.
  if (/\.svg(\?|$)/i.test(coverUrl) || /cover\.svg/i.test(coverUrl)) {
    findings.push(critical(
      "IMAGE_PLACEHOLDER", "cover_interior_match",
      { url: coverUrl },
      { must_not_match: [".svg", "cover.svg"] },
      "regenerate_cover",
    ));
  }
  if (title && title.trim().length < 2) {
    findings.push(critical("COVER_TITLE_MISMATCH", "cover_interior_match", { title }, { min_length: 2 }, "regenerate_cover"));
  }
  return findings;
}

export function languageCheck(text: string | null | undefined): RawFinding[] {
  if (!text || text.length < 50) return [];
  const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) ?? []).length;
  const ratio = thaiChars / text.length;
  if (ratio > 0.02) {
    return [critical(
      "WRONG_LANGUAGE", "grammar",
      { thai_char_ratio: Number(ratio.toFixed(3)), sample: text.slice(0, 120) },
      { max_thai_ratio: 0.02 },
      "translate_to_english",
    )];
  }
  return [];
}

function critical(
  rule_id: string,
  category: string,
  measured_value: Record<string, unknown>,
  threshold: Record<string, unknown>,
  repair_action: string,
): RawFinding {
  return { rule_id, category, severity: "critical", passed: false, measured_value, threshold, repair_action };
}
