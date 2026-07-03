// Shared premium-ebook-master QC gate computation.
// Reads from an `ebooks` row (scalar mirror columns + JSON reports) and
// returns a normalized, UI-friendly gate report. Used by admin-data to
// render the QC Gate Card and by requeue-legacy-qc to decide which
// ebooks need to be pulled back through the pipeline.
//
// Thresholds match `.workspace/skills/premium-ebook-master/SKILL.md`:
//   Formatter QC      >= 90
//   Reader QC         >= 90
//   PDF cover full A4 == 100
//   Cover thumbnail   >= 90

export type GateName = "formatter" | "reader" | "cover_pdf" | "cover_thumb";

export interface GateResult {
  score: number | null;
  pass: boolean;
  target: number;
  breakdown?: Record<string, number | null>;
  status?: string | null;
  attempts?: number | null;
}

export interface QcGateReport {
  formatter: GateResult;
  reader: GateResult;
  cover_pdf: GateResult;
  cover_thumb: GateResult;
  ready_for_shopify: boolean;
  blocking_gates: GateName[];
  missing_gates: GateName[]; // gates that have no data yet (legacy books)
}

type Json = Record<string, unknown> | null | undefined;

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickJson(v: unknown): Json {
  if (!v || typeof v !== "object") return null;
  return v as Json;
}

function avg(vals: (number | null)[]): number | null {
  const xs = vals.filter((x): x is number => x != null);
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

export function computeQcGates(row: Record<string, unknown>): QcGateReport {
  const pdfQc = pickJson(row.pdf_qc);
  const readerQc = pickJson(row.reader_experience_qc);
  const coverQc = pickJson(row.cover_qc);

  // Formatter QC — from pdf_qc breakdown, falls back to pdf_score.
  const fmtBreakdown = {
    typography: num(pdfQc?.typography_score),
    reading_comfort: num(pdfQc?.reading_comfort_score),
    table_render: num(pdfQc?.table_render_score),
    worksheet_layout: num(pdfQc?.worksheet_layout_score),
    premium_layout: num(pdfQc?.premium_layout_score),
    raw_markdown: num(pdfQc?.raw_markdown_score),
  };
  const fmtScore = avg(Object.values(fmtBreakdown)) ?? num(row.pdf_score);
  const fmtHasData = Object.values(fmtBreakdown).some((x) => x != null) ||
    num(row.pdf_score) != null;
  const formatter: GateResult = {
    score: fmtScore,
    pass: fmtScore != null && fmtScore >= 90 &&
      (fmtBreakdown.raw_markdown == null || fmtBreakdown.raw_markdown === 100),
    target: 90,
    breakdown: fmtBreakdown,
  };

  // Reader QC.
  const readerVerdict = pickJson(readerQc?.verdict);
  const readerScores = pickJson(readerVerdict?.scores) ?? pickJson(readerQc?.scores) ?? readerQc;
  const readerBreakdown = {
    natural_language: num(readerScores?.natural_language_score),
    human_feel: num(readerScores?.human_feel_score) ?? num(readerScores?.human_written_feel_score),
    emotional_resonance: num(readerScores?.emotional_resonance_score),
    page_turning: num(readerScores?.page_turning_score) ?? num(readerScores?.reader_engagement_score),
    sellability: num(readerScores?.sellability_score) ?? num(readerScores?.premium_sellability_score),
    clarity: num(readerScores?.clarity_score),
    variety: num(readerScores?.variety_score) ?? num(readerScores?.readability_score),
    no_ai_patterns: num(readerScores?.no_ai_patterns_score) ?? num(readerScores?.human_written_feel_score),
    no_repetition: num(readerScores?.no_repetition_score) ?? num(readerScores?.non_repetitive_score),
    voice_consistency: num(readerScores?.voice_consistency_score) ?? num(readerScores?.voice_quality_score),
    trust: num(readerScores?.trust_score) ?? num(readerScores?.insight_score),
  };
  const readerScore = num(row.reader_experience_score) ??
    num(readerQc?.overall_score) ??
    num(readerVerdict?.overall_score) ??
    avg(Object.values(readerBreakdown));
  const readerStatus = (row.reader_experience_status as string | null) ?? null;
  const readerHasData = readerScore != null ||
    readerStatus === "pass" || readerStatus === "passed" || readerStatus === "failed";
  const reader: GateResult = {
    score: readerScore,
    pass: readerScore != null && readerScore >= 90 && readerStatus !== "failed",
    target: 90,
    status: readerStatus,
    attempts: num(row.reader_experience_fix_count),
    breakdown: readerBreakdown,
  };

  // Cover PDF (full A4). The producer is render-pdf, so the canonical score
  // lives in pdf_qc. cover_qc is kept as a backwards-compatible mirror because
  // older UI/retry code looked there.
  const coverPdfScore = num(pdfQc?.pdf_cover_full_a4_score) ??
    num(pdfQc?.cover_full_a4_score) ??
    num(pdfQc?.cover_full_bleed_score) ??
    num(coverQc?.pdf_cover_full_a4_score) ??
    num(coverQc?.cover_full_a4_score) ??
    num(coverQc?.cover_full_bleed_score);
  const coverPdfHasData = coverPdfScore != null;
  const cover_pdf: GateResult = {
    score: coverPdfScore,
    pass: coverPdfScore === 100,
    target: 100,
    breakdown: {
      full_a4: coverPdfScore,
    },
  };

  // Cover thumbnail (3D mockup).
  const thumbBreakdown = {
    book_mockup: num(coverQc?.thumbnail_book_mockup_score),
    readability: num(coverQc?.thumbnail_readability_score),
    click_appeal: num(coverQc?.shopify_click_appeal_score) ??
      num(coverQc?.shopify_click_appeal),
    premium_feel: num(coverQc?.premium_product_feel_score) ??
      num(coverQc?.premium_product_feel),
  };
  const thumbScore = avg(Object.values(thumbBreakdown)) ?? num(row.cover_score);
  const thumbHasData = Object.values(thumbBreakdown).some((x) => x != null);
  const cover_thumb: GateResult = {
    score: thumbScore,
    pass: thumbScore != null && thumbScore >= 90 && thumbHasData,
    target: 90,
    breakdown: thumbBreakdown,
  };

  const gates: [GateName, GateResult, boolean][] = [
    ["formatter", formatter, fmtHasData],
    ["reader", reader, readerHasData],
    ["cover_pdf", cover_pdf, coverPdfHasData],
    ["cover_thumb", cover_thumb, thumbHasData],
  ];

  const blocking_gates = gates.filter(([, g]) => !g.pass).map(([n]) => n);
  const missing_gates = gates.filter(([, , hasData]) => !hasData).map(([n]) => n);
  const ready_for_shopify = blocking_gates.length === 0;

  return {
    formatter,
    reader,
    cover_pdf,
    cover_thumb,
    ready_for_shopify,
    blocking_gates,
    missing_gates,
  };
}

// Human-friendly reason for why a legacy ebook must be pulled back to QC.
export function legacyRequeueReason(report: QcGateReport): string | null {
  const parts: string[] = [];
  if (report.missing_gates.includes("reader")) parts.push("missing Reader QC");
  if (report.missing_gates.includes("formatter")) parts.push("missing Formatter QC");
  if (report.missing_gates.includes("cover_pdf")) parts.push("missing full-A4 cover check");
  if (report.missing_gates.includes("cover_thumb")) parts.push("missing thumbnail mockup check");
  const failing = report.blocking_gates.filter((g) => !report.missing_gates.includes(g));
  for (const g of failing) {
    if (g === "formatter") parts.push("Formatter QC below 90");
    if (g === "reader") parts.push("Reader QC below 90");
    if (g === "cover_pdf") parts.push("Cover not full A4 (100)");
    if (g === "cover_thumb") parts.push("Thumbnail mockup below 90");
  }
  if (parts.length === 0) return null;
  return `Legacy re-QC: ${parts.join(", ")}`;
}
