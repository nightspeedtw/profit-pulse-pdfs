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

// Detects glyph mangling in a rendered PDF by scanning content streams for
// characters that base-14 Helvetica silently substitutes when it gets
// Unicode it can't render. Notably U+0192 "ƒ" appears where curly quotes
// were dropped. Also flags the U+FFFD replacement char.
export async function preflightPdfGlyphs(pdfUrl: string | null | undefined): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];
  if (!pdfUrl) return findings;
  let bytes: Uint8Array;
  try {
    const r = await fetch(pdfUrl);
    if (!r.ok) return findings;
    bytes = new Uint8Array(await r.arrayBuffer());
  } catch {
    return findings;
  }
  // Latin1 decode of raw stream — matches how the operators are stored.
  const raw = new TextDecoder("latin1").decode(bytes);

  // Extract text inside (...)Tj / (...)TJ operators. Rough but effective for
  // our own-emitted PDFs where content streams aren't Flate-compressed.
  const textMatches = Array.from(raw.matchAll(/\(([^)]{0,400})\)\s*(?:Tj|TJ)/g)).map((m) => m[1]);
  const joined = textMatches.join(" ");
  const florinCount = (joined.match(/\u0083|ƒ/g) ?? []).length;
  const replCount = (joined.match(/\uFFFD/g) ?? []).length;
  const suspiciousControl = (joined.match(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g) ?? []).length;

  if (florinCount + replCount + suspiciousControl > 0) {
    findings.push(critical(
      "PDF_GLYPH_MANGLING", "pdf_preflight",
      { florin_or_0x83: florinCount, replacement_char: replCount, control_chars: suspiciousControl,
        sample: joined.slice(0, 160) },
      { max_allowed: 0 },
      "rerender_pdf_with_ascii_normalization",
    ));
  } else if (textMatches.length > 0) {
    findings.push(pass("PDF_TEXT_EXTRACTABLE", "pdf_preflight",
      { text_ops: textMatches.length }, { min: 1 }));
  }

  return findings;
}

// Simple age-band → thresholds map.
export function kidsThresholdsForAge(ageLabel: string | null | undefined, intensity: "high" | "standard" = "high"): { min_interior: number; min_previews: number } {
  if (intensity === "high") return { min_interior: 12, min_previews: 3 };
  return { min_interior: 6, min_previews: 3 };
}
