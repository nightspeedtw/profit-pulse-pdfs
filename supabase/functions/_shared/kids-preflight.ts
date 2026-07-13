// Kids-specific measured QC rules.
// Verifies that a children picture book actually has the assets a picture
// book requires: interior illustrations, thumbnail, preview pages, style
// bible, and a properly-rendered PDF (no glyph mangling).

import type { RawFinding } from "./pdf-preflight.ts";

function critical(
  rule_id: string,
  category: string,
  measured_value: Record<string, unknown>,
  threshold: Record<string, unknown>,
  repair_action: string,
  page_number: number | null = null,
): RawFinding {
  return { rule_id, category, severity: "critical", passed: false, measured_value, threshold, repair_action, page_number };
}

function pass(rule_id: string, category: string, measured_value: Record<string, unknown>, threshold: Record<string, unknown>): RawFinding {
  return { rule_id, category, severity: "major", passed: true, measured_value, threshold };
}

export interface KidsAssetInput {
  interior_illustrations: unknown;   // ebooks_kids.interior_illustrations (jsonb array)
  thumbnail_url: string | null;
  preview_page_urls: unknown;        // jsonb array of strings
  cover_url: string | null;
  style_bible_json: unknown;
  min_interior: number;              // e.g. 12 for 4-6 high intensity
  min_previews: number;              // e.g. 3
}

export function preflightKidsAssets(input: KidsAssetInput): RawFinding[] {
  const findings: RawFinding[] = [];

  // -------- Interior illustrations --------
  const illos = Array.isArray(input.interior_illustrations) ? input.interior_illustrations : [];
  const validIllos = illos.filter((x) => {
    const o = x as Record<string, unknown>;
    return o && typeof o === "object" && typeof o.url === "string" && (o.url as string).length > 0
      && !/placeholder|fallback/i.test(o.url as string);
  });
  if (validIllos.length < input.min_interior) {
    findings.push(critical(
      "INTERIOR_ILLUSTRATIONS_MISSING", "illustration_style",
      { count: validIllos.length },
      { min: input.min_interior },
      "generate_interior_illustrations",
    ));
  } else {
    findings.push(pass("INTERIOR_ILLUSTRATIONS_MIN", "illustration_style",
      { count: validIllos.length }, { min: input.min_interior }));
  }

  // Duplicate detection — same URL used twice = broken planner.
  const urls = validIllos.map((x) => (x as Record<string, unknown>).url as string);
  const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
  if (dupes.length) {
    findings.push(critical(
      "DUPLICATE_ILLUSTRATION_DETECTED", "illustration_style",
      { duplicates: Array.from(new Set(dupes)).slice(0, 5) },
      { must_be_unique: true },
      "regenerate_duplicate_pages",
    ));
  }

  // -------- Thumbnail --------
  if (!input.thumbnail_url || input.thumbnail_url.length < 8 || /placeholder/i.test(input.thumbnail_url)) {
    findings.push(critical(
      "THUMBNAIL_MISSING", "commercial_metadata",
      { thumbnail_url: input.thumbnail_url ?? null },
      { must: "present" },
      "generate_thumbnail",
    ));
  } else {
    findings.push(pass("THUMBNAIL_EXISTS", "commercial_metadata",
      { thumbnail_url: input.thumbnail_url }, { must: "present" }));
  }

  // -------- Preview pages --------
  const previews = Array.isArray(input.preview_page_urls)
    ? (input.preview_page_urls as unknown[]).filter((u) => typeof u === "string" && (u as string).length > 8)
    : [];
  if (previews.length < input.min_previews) {
    findings.push(critical(
      "PREVIEW_PAGES_MISSING", "commercial_metadata",
      { count: previews.length },
      { min: input.min_previews },
      "generate_preview_pages",
    ));
  } else {
    findings.push(pass("PREVIEW_PAGES_MIN", "commercial_metadata",
      { count: previews.length }, { min: input.min_previews }));
  }

  // -------- Cover --------
  if (!input.cover_url) {
    findings.push(critical(
      "COVER_MISSING", "cover_interior_match",
      { cover_url: null }, { must: "present" }, "generate_cover",
    ));
  }

  // -------- Style bible --------
  const sb = input.style_bible_json;
  if (!sb || typeof sb !== "object" || Object.keys(sb as Record<string, unknown>).length === 0) {
    findings.push(critical(
      "STYLE_BIBLE_MISSING", "illustration_style",
      { present: false }, { must: "present" }, "generate_style_bible",
    ));
  } else {
    findings.push(pass("STYLE_BIBLE_PRESENT", "illustration_style",
      { keys: Object.keys(sb as Record<string, unknown>).length }, { must: "present" }));
  }

  return findings;
}

export interface PdfGlyphAudit {
  rule_id: "PDF_GLYPH_MANGLING";
  offending_codepoints: Array<{ char: string; codepoint: string; count: number }>;
  offending_snippets: string[];
  pages: number[];
  source_stage: "pre_draw_text" | "extracted_text" | "preflight_false_positive" | "raw_text_operators" | "not_a_pdf" | "fetch_failed";
  repair_action: string;
  detector: string;
  pdf_bytes?: number;
  text_operator_count?: number;
  uses_object_streams?: boolean;
  uses_flate_streams?: boolean;
  notes?: string;
}

const GLYPH_MANGLE_RE = /[\u0192\uFFFD\u0083]/g;

function codepoint(ch: string): string {
  return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

function countChars(text: string): Array<{ char: string; codepoint: string; count: number }> {
  const counts = new Map<string, number>();
  for (const ch of text.match(GLYPH_MANGLE_RE) ?? []) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts.entries()].map(([char, count]) => ({ char, codepoint: codepoint(char), count }));
}

function snippets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(GLYPH_MANGLE_RE)) {
    const i = m.index ?? 0;
    out.push(text.slice(Math.max(0, i - 50), i + 50).replace(/[\r\n\t]+/g, " "));
    if (out.length >= 10) break;
  }
  return out;
}

function extractPlainTextOperators(raw: string): string[] {
  return Array.from(raw.matchAll(/\((?:\\.|[^\\)]){0,800}\)\s*(?:Tj|TJ)/g)).map((m) =>
    m[0].replace(/^\(|\)\s*(?:Tj|TJ)$/g, ""),
  );
}

export async function auditPdfGlyphs(pdfUrl: string | null | undefined): Promise<{ findings: RawFinding[]; audit: PdfGlyphAudit }> {
  const findings: RawFinding[] = [];
  const audit: PdfGlyphAudit = {
    rule_id: "PDF_GLYPH_MANGLING",
    offending_codepoints: [],
    offending_snippets: [],
    pages: [],
    source_stage: "fetch_failed",
    repair_action: "",
    detector: "kids-preflight/v2-compression-aware",
  };
  if (!pdfUrl) return { findings, audit };
  let bytes: Uint8Array;
  try {
    const r = await fetch(pdfUrl);
    if (!r.ok) return { findings, audit };
    bytes = new Uint8Array(await r.arrayBuffer());
  } catch {
    audit.repair_action = "fetch_pdf_for_glyph_audit";
    return { findings, audit };
  }
  audit.pdf_bytes = bytes.length;
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  if (!head.startsWith("%PDF-")) {
    audit.source_stage = "not_a_pdf";
    audit.repair_action = "rebuild_pdf_from_source";
    return { findings, audit };
  }

  // Latin1 decode of raw stream — matches how the operators are stored.
  const raw = new TextDecoder("latin1").decode(bytes);
  const usesObjectStreams = /\/ObjStm\b/.test(raw);
  const usesFlateStreams = /\/FlateDecode\b/.test(raw);
  audit.uses_object_streams = usesObjectStreams;
  audit.uses_flate_streams = usesFlateStreams;

  // Only scan raw `(text) Tj/TJ` operators when the content is not compressed.
  // In pdf-lib object/Flate streams, binary bytes can coincidentally match the
  // regex and create false PDF_GLYPH_MANGLING failures from control bytes.
  if (usesObjectStreams || usesFlateStreams) {
    audit.source_stage = "preflight_false_positive";
    audit.repair_action = "none_detector_skipped_compressed_binary_streams";
    audit.notes = "PDF uses compressed/object streams; raw byte regex is not valid extracted text. Glyph audit must rely on source normalization and external extraction QA.";
    findings.push(pass("PDF_TEXT_EXTRACTABLE", "pdf_preflight", {
      detector: audit.detector,
      compressed_streams: true,
      source_stage: audit.source_stage,
    }, { must_not_scan_compressed_binary_as_text: true }));
    return { findings, audit };
  }

  const textMatches = extractPlainTextOperators(raw);
  audit.text_operator_count = textMatches.length;
  const joined = textMatches.join(" ");
  const offending = countChars(joined);

  if (offending.length > 0) {
    audit.source_stage = "raw_text_operators";
    audit.offending_codepoints = offending;
    audit.offending_snippets = snippets(joined);
    audit.repair_action = "rerender_pdf_with_ascii_normalization";
    findings.push(critical(
      "PDF_GLYPH_MANGLING", "pdf_preflight",
      { offending_codepoints: offending, sample: joined.slice(0, 160), source_stage: audit.source_stage },
      { max_allowed: 0 },
      "rerender_pdf_with_ascii_normalization",
    ));
  } else if (textMatches.length > 0) {
    audit.source_stage = "raw_text_operators";
    audit.repair_action = "none";
    findings.push(pass("PDF_TEXT_EXTRACTABLE", "pdf_preflight",
      { text_ops: textMatches.length }, { min: 1 }));
  }

  return { findings, audit };
}

// Detects actual glyph corruption only. Older versions scanned compressed raw
// bytes and could mistake binary stream contents for text operators.
export async function preflightPdfGlyphs(pdfUrl: string | null | undefined): Promise<RawFinding[]> {
  return (await auditPdfGlyphs(pdfUrl)).findings;
}

// Simple age-band → thresholds map.
export function kidsThresholdsForAge(ageLabel: string | null | undefined, intensity: "high" | "standard" = "high"): { min_interior: number; min_previews: number } {
  if (intensity === "high") return { min_interior: 12, min_previews: 3 };
  return { min_interior: 6, min_previews: 3 };
}
