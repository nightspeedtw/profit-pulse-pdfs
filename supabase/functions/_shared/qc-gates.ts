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
  ready_for_storefront: boolean;
  blocking_gates: GateName[];
  missing_gates: GateName[]; // gates that have no data yet (legacy books)
}

export interface GateContract {
  gate: GateName;
  target: number;
  required_fields: string[];
  source_paths: string[];
  producer_function: string;
  persist_target: string;
  pass_rule: string;
}

export const READER_FIELD_TARGETS: Record<string, number> = {
  natural_language: 90,
  human_feel: 90,
  emotional_resonance: 85,
  page_turning: 85,
  sellability: 90,
  clarity: 90,
  variety: 90,
  no_ai_patterns: 90,
  no_repetition: 90,
  voice_consistency: 90,
  trust: 85,
};

export const COVER_THUMB_FIELD_TARGETS: Record<string, number> = {
  book_mockup: 90,
  readability: 90,
  click_appeal: 90,
  premium_feel: 90,
};

export const GATE_CONTRACTS: Record<GateName, GateContract> = {
  formatter: {
    gate: "formatter",
    target: 90,
    required_fields: [
      "formatting_score or formatter_score",
      "typography",
      "reading_comfort",
      "table_render",
      "worksheet_layout",
      "premium_layout",
      "raw_markdown",
    ],
    source_paths: [
      "ebooks.pdf_qc.formatting_score | formatter_score",
      "ebooks.pdf_qc.typography_score | typography",
      "ebooks.pdf_qc.reading_comfort_score | reading_comfort",
      "ebooks.pdf_qc.table_render_score | table_render",
      "ebooks.pdf_qc.worksheet_layout_score | worksheet_layout",
      "ebooks.pdf_qc.premium_layout_score | premium_layout",
      "ebooks.pdf_qc.raw_markdown_score | no_raw_markdown_score",
    ],
    producer_function: "render-pdf",
    persist_target: "ebooks.pdf_qc, ebooks.pdf_score",
    pass_rule: "canonical formatter score >= 90; typography/reading_comfort/table_render/worksheet_layout/premium_layout >= 90; raw_markdown == 100",
  },
  reader: {
    gate: "reader",
    target: 90,
    required_fields: [
      "overall_score",
      "natural_language",
      "human_feel",
      "emotional_resonance",
      "page_turning",
      "sellability",
      "clarity",
      "variety",
      "no_ai_patterns",
      "no_repetition",
      "voice_consistency",
      "trust",
    ],
    source_paths: [
      "ebooks.reader_experience_qc.overall_score",
      "ebooks.reader_experience_qc.scores.*",
      "ebooks.reader_experience_qc.verdict.scores.*",
      "ebooks.reader_experience_score (legacy display fallback only)",
    ],
    producer_function: "reader-experience-qc",
    persist_target: "ebooks.reader_experience_qc, ebooks.reader_experience_score, ebooks.reader_experience_status",
    pass_rule: "overall_score >= 90; natural_language/human_feel/sellability/clarity/variety/no_ai_patterns/no_repetition/voice_consistency >= 90; emotional_resonance/page_turning/trust >= 85; status passable",
  },
  cover_pdf: {
    gate: "cover_pdf",
    target: 100,
    required_fields: ["full_a4"],
    source_paths: [
      "ebooks.pdf_qc.pdf_cover_full_a4_score | cover_full_a4_score | cover_full_bleed_score",
      "ebooks.cover_qc.pdf_cover_full_a4_score | cover_full_a4_score | cover_full_bleed_score (legacy mirror)",
    ],
    producer_function: "render-pdf",
    persist_target: "ebooks.pdf_qc, legacy mirror ebooks.cover_qc",
    pass_rule: "full_a4 score must equal 100 exactly",
  },
  cover_thumb: {
    gate: "cover_thumb",
    target: 90,
    required_fields: [
      "overall_score",
      "book_mockup",
      "readability",
      "click_appeal",
      "premium_feel",
      "thumbnail_url",
    ],
    source_paths: [
      "ebooks.cover_qc.scores.thumbnail_book_mockup | thumbnail_book_mockup_score | book_mockup",
      "ebooks.cover_qc.scores.thumbnail_readability | thumbnail_readability_score",
      "ebooks.cover_qc.scores.storefront_click_appeal | click_appeal",
      "ebooks.cover_qc.scores.premium_product_feel | premium_feel",
      "ebooks.cover_score (legacy display fallback only)",
      "ebooks.thumbnail_url",
    ],
    producer_function: "generate-cover",
    persist_target: "ebooks.cover_qc, ebooks.cover_score, ebooks.thumbnail_url",
    pass_rule: "thumbnail_url exists; overall_score >= 90; book_mockup/readability/click_appeal/premium_feel all exist and are >= 90",
  },
};

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

function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = num(v);
    if (n != null) return n;
  }
  return null;
}

export function computeQcGates(row: Record<string, unknown>): QcGateReport {
  const pdfQc = pickJson(row.pdf_qc);
  const readerQc = pickJson(row.reader_experience_qc);
  const coverQc = pickJson(row.cover_qc);

  // Formatter QC — from pdf_qc breakdown, falls back to pdf_score.
  const fmtBreakdown = {
    typography: firstNum(pdfQc?.typography_score, pdfQc?.typography),
    reading_comfort: firstNum(pdfQc?.reading_comfort_score, pdfQc?.reading_comfort),
    table_render: firstNum(pdfQc?.table_render_score, pdfQc?.table_render),
    worksheet_layout: firstNum(pdfQc?.worksheet_layout_score, pdfQc?.worksheet_layout),
    premium_layout: firstNum(pdfQc?.premium_layout_score, pdfQc?.premium_layout),
    raw_markdown: firstNum(pdfQc?.raw_markdown_score, pdfQc?.no_raw_markdown_score),
  };
  const fmtDesignScores = [
    fmtBreakdown.typography,
    fmtBreakdown.reading_comfort,
    fmtBreakdown.table_render,
    fmtBreakdown.worksheet_layout,
    fmtBreakdown.premium_layout,
  ];
  const fmtCanonicalScore = firstNum(pdfQc?.formatting_score, pdfQc?.formatter_score) ??
    avg(fmtDesignScores);
  // pdf_score is the overall PDF premium score, not the formatter contract. Use
  // it only as a legacy display fallback; do not let it satisfy the formatter
  // gate when the producer failed to persist formatter fields.
  const fmtScore = fmtCanonicalScore ?? num(row.pdf_score);
  const fmtHasData = fmtCanonicalScore != null;
  const fmtDimsPass = fmtDesignScores.every((v) => v != null && v >= 90);
  const formatter: GateResult = {
    score: fmtScore,
    pass: fmtCanonicalScore != null && fmtCanonicalScore >= 90 && fmtDimsPass &&
      fmtBreakdown.raw_markdown === 100,
    target: 90,
    breakdown: fmtBreakdown,
  };

  // Reader QC.
  const readerVerdict = pickJson(readerQc?.verdict);
  const readerScores = pickJson(readerVerdict?.scores) ?? pickJson(readerQc?.scores) ?? readerQc;
  const readerBreakdown = {
    natural_language: firstNum(readerScores?.natural_language_score, readerScores?.natural_language),
    human_feel: firstNum(readerScores?.human_feel_score, readerScores?.human_feel, readerScores?.human_written_feel_score),
    emotional_resonance: firstNum(readerScores?.emotional_resonance_score, readerScores?.emotional_resonance),
    page_turning: firstNum(readerScores?.page_turning_score, readerScores?.page_turning, readerScores?.reader_engagement_score),
    sellability: firstNum(readerScores?.sellability_score, readerScores?.sellability, readerScores?.premium_sellability_score),
    clarity: firstNum(readerScores?.clarity_score, readerScores?.clarity),
    variety: firstNum(readerScores?.variety_score, readerScores?.variety, readerScores?.readability_score),
    no_ai_patterns: firstNum(readerScores?.no_ai_patterns_score, readerScores?.no_ai_patterns, readerScores?.human_written_feel_score),
    no_repetition: firstNum(readerScores?.no_repetition_score, readerScores?.no_repetition, readerScores?.non_repetitive_score),
    voice_consistency: firstNum(readerScores?.voice_consistency_score, readerScores?.voice_consistency, readerScores?.voice_quality_score),
    trust: firstNum(readerScores?.trust_score, readerScores?.trust, readerScores?.insight_score),
  };
  const readerScore = firstNum(readerQc?.overall_score, readerVerdict?.overall_score) ??
    avg(Object.values(readerBreakdown)) ??
    num(row.reader_experience_score);
  const readerStatus = (row.reader_experience_status as string | null) ?? null;
  const readerStatusPassable = readerStatus == null || readerStatus === "pass" || readerStatus === "passed";
  const readerDims = Object.values(readerBreakdown);
  const readerHasBreakdown = readerDims.every((x) => x != null);
  const readerDimsPass = Object.entries(READER_FIELD_TARGETS).every(([field, target]) => {
    const v = readerBreakdown[field as keyof typeof readerBreakdown];
    return v != null && v >= target;
  });
  const readerHasData = readerScore != null && readerHasBreakdown;
  const reader: GateResult = {
    score: readerScore,
    pass: readerScore != null && readerScore >= 90 && readerDimsPass && readerStatusPassable,
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
  // The generate-cover producer stores raw AI critic output under
  // `cover_qc.scores.<dimension>` (no `_score` suffix). Older/repair paths
  // may also mirror `<dimension>_score` at the top level. Support both so the
  // breakdown never comes back as nil when the producer actually scored.
  const coverScores = pickJson(coverQc?.scores) ?? {};
  const pickThumb = (base: string): number | null =>
    num(coverScores?.[base]) ??
    num(coverScores?.[`${base}_score`]) ??
    num(coverQc?.[`${base}_score`]) ??
    num(coverQc?.[base]);
  const thumbBreakdown = {
    book_mockup: pickThumb("thumbnail_book_mockup") ?? pickThumb("book_mockup") ?? pickThumb("thumbnail_is_3d_mockup"),
    readability: pickThumb("thumbnail_readability"),
    click_appeal: pickThumb("storefront_click_appeal") ?? pickThumb("click_appeal"),
    premium_feel: pickThumb("premium_product_feel") ?? pickThumb("premium_feel"),
  };
  const thumbScore = num(coverQc?.overall_score) ?? avg(Object.values(thumbBreakdown)) ?? num(row.cover_score);
  const thumbnailUrl = typeof row.thumbnail_url === "string" && row.thumbnail_url.trim().length > 0
    ? row.thumbnail_url
    : null;
  const thumbHasData = !!thumbnailUrl && Object.values(thumbBreakdown).every((x) => x != null);
  const allThumbDimsPass = Object.entries(COVER_THUMB_FIELD_TARGETS).every(([field, target]) => {
    const v = thumbBreakdown[field as keyof typeof thumbBreakdown];
    return v != null && v >= target;
  });
  // Producer-authoritative pass: when generate-cover has explicitly signed off
  // (cover_qc.passed === true) AND the overall score meets the gate target, we
  // trust the producer even if a downstream breakdown recompute races and
  // temporarily nulls a sub-score. This kills the stale-writer loop where
  // autofix keeps re-flipping cover_thumb.pass=false on an already-passing cover.
  const coverOverall = num(coverQc?.overall_score);
  const coverProducerPassed =
    coverQc?.passed === true && coverOverall != null && coverOverall >= 90 && !!thumbnailUrl;
  const cover_thumb: GateResult = {
    score: thumbScore,
    pass: coverProducerPassed || (thumbHasData && thumbScore != null && thumbScore >= 90 && allThumbDimsPass),
    target: 90,
    breakdown: thumbBreakdown,
  };

  const gates: [GateName, GateResult, boolean][] = [
    ["formatter", formatter, fmtHasData],
    ["reader", reader, readerHasData],
    ["cover_pdf", cover_pdf, coverPdfHasData],
    ["cover_thumb", cover_thumb, thumbHasData || coverProducerPassed],
  ];

  const blocking_gates = gates.filter(([, g]) => !g.pass).map(([n]) => n);
  const missing_gates = gates.filter(([, , hasData]) => !hasData).map(([n]) => n);
  const ready_for_storefront = blocking_gates.length === 0;

  return {
    formatter,
    reader,
    cover_pdf,
    cover_thumb,
    ready_for_storefront,
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
