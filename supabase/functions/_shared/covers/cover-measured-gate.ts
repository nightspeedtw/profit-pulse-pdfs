// Pure measured cover-gate helpers. Runtime vision callers persist the raw
// OCR/hero/logo/frame evidence; these functions convert that evidence into
// the scorecard consumed by coloringCoverGate. No constants-as-gates.

export interface CoverTextEvidence {
  detected_text?: string | null;
  has_glyphs?: boolean;
  degraded?: boolean;
}

export const MEASURED_COVER_GATE_VERSION = "v2:exact-vision-text-source-frame-logo-nonblank";

export interface CoverHeroEvidence {
  matches?: boolean;
  forbidden_hit?: string | null;
  detected_subjects?: string[];
  degraded?: boolean;
}

export interface CoverFrameElement {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoverFrameEvidence {
  width: number;
  height: number;
  safe_margin: number;
  elements: CoverFrameElement[];
}

export interface CoverLogoEvidence {
  present?: boolean;
  rect?: CoverFrameElement | null;
}

export interface MeasuredCoverGateInput {
  title: string;
  subtitle?: string | null;
  ageBadge?: string | null;
  text: CoverTextEvidence;
  rawArtText?: CoverTextEvidence | null;
  typographySource?: "textless_art_plus_svg_overlay" | "baked_ideogram_no_overlay";
  hero?: CoverHeroEvidence | null;
  frame: CoverFrameEvidence;
  logo: CoverLogoEvidence;
  artwork?: {
    used_svg_fallback?: boolean;
    synthesized_background?: boolean;
    blank_background?: boolean;
    blank_ratio?: number | null;
  } | null;
  quality?: { produced_bytes?: boolean; luminance_dead?: boolean; byte_size?: number | null } | null;
  pageCountMatchesFinalPdf: boolean;
}

export function normalizeCoverText(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function splitDetectedPhrases(text: string | null | undefined): string[] {
  return normalizeCoverText(text)
    .split(/\s*(?:\||\n|,|;|\/|\\|•|·)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function approvedTextSet(input: Pick<MeasuredCoverGateInput, "title" | "subtitle" | "ageBadge">): Set<string> {
  const out = new Set<string>();
  for (const raw of [input.title, input.subtitle ?? "", input.ageBadge ?? "", "secretpdf kids", "secretpdf", "secretpdf co", "secretpdf.co", "© secretpdf.co"]) {
    const n = normalizeCoverText(raw);
    if (n) out.add(n);
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const idx = haystack.indexOf(needle, start);
    if (idx < 0) return count;
    count += 1;
    start = idx + needle.length;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function evaluateExactCoverTranscription(
  input: Pick<MeasuredCoverGateInput, "title" | "subtitle" | "ageBadge" | "text">,
): { pass: boolean; missing: string[]; duplicate: string[]; extra: string[]; degraded: boolean } {
  const degraded = input.text.degraded === true;
  const full = normalizeCoverText(input.text.detected_text ?? "");
  const required = [input.title, input.subtitle ?? "", input.ageBadge ?? "", "SecretPDF Kids"]
    .map((s) => normalizeCoverText(s))
    .filter(Boolean);
  const title = normalizeCoverText(input.title);
  const subtitle = normalizeCoverText(input.subtitle ?? "");
  const age = normalizeCoverText(input.ageBadge ?? "");
  const missing: string[] = [];
  const duplicate: string[] = [];
  let remainder = ` ${full} `;
  for (const expected of [...required].sort((a, b) => b.length - a.length)) {
    const n = countOccurrences(full, expected);
    const maxAllowed = expected === age && subtitle.includes(age) ? 2 : 1;
    if (n === 0) missing.push(expected);
    if ((expected === title || expected === subtitle || expected === "secretpdf kids") && n > maxAllowed) duplicate.push(expected);
    remainder = remainder.replace(new RegExp(` ${escapeRegExp(expected)} `, "g"), " ");
  }
  const extra = normalizeCoverText(remainder)
    ? splitDetectedPhrases(remainder).filter((p) => p && !required.includes(p))
    : [];
  return { pass: !degraded && missing.length === 0 && duplicate.length === 0 && extra.length === 0, missing, duplicate, extra, degraded };
}

export function findUnapprovedCoverText(input: Pick<MeasuredCoverGateInput, "title" | "subtitle" | "ageBadge" | "text">): string[] {
  if (input.text.degraded) return ["vision_transcription_degraded"];
  const exact = evaluateExactCoverTranscription(input);
  if (!exact.pass) {
    return [
      ...exact.missing.map((s) => `missing:${s}`),
      ...exact.duplicate.map((s) => `duplicate:${s}`),
      ...exact.extra,
      ...(exact.degraded ? ["vision_transcription_degraded"] : []),
    ];
  }
  const detected = splitDetectedPhrases(input.text.detected_text ?? "");
  if (!input.text.has_glyphs && detected.length === 0) return [];
  const approved = approvedTextSet(input);
  const full = normalizeCoverText(input.text.detected_text ?? "");
  const title = normalizeCoverText(input.title);
  const duplicateTitleMatches = title ? full.split(title).length - 1 : 0;
  if (duplicateTitleMatches > 1) return [`duplicate_title:${input.title}`];
  if (full && approved.has(full)) return [];
  return detected.filter((phrase) => {
    if (approved.has(phrase)) return false;
    // OCR often returns title/subtitle in one line; allow exact approved
    // substrings but reject any extra token outside them.
    let remainder = ` ${phrase} `;
    for (const ok of approved) remainder = remainder.replace(` ${ok} `, " ");
    return normalizeCoverText(remainder).length > 0;
  });
}

export function frameElementsInsideSafeMargin(frame: CoverFrameEvidence): { pass: boolean; clipped: string[] } {
  const clipped: string[] = [];
  const min = frame.safe_margin;
  const maxX = frame.width - frame.safe_margin;
  const maxY = frame.height - frame.safe_margin;
  for (const el of frame.elements) {
    if (el.x < min || el.y < min || el.x + el.w > maxX || el.y + el.h > maxY) clipped.push(el.name);
  }
  return { pass: clipped.length === 0, clipped };
}

function hasRawArtText(input: MeasuredCoverGateInput): boolean {
  const raw = input.rawArtText;
  if (!raw) return true;
  if (raw.degraded) return true;
  return raw.has_glyphs === true || normalizeCoverText(raw.detected_text ?? "").length > 0;
}

export function measuredCoverScorecard(input: MeasuredCoverGateInput) {
  const unapprovedText = findUnapprovedCoverText(input);
  const frameInput = input.logo.rect
    ? { ...input.frame, elements: [...input.frame.elements, input.logo.rect].filter((el, i, arr) => arr.findIndex((e) => e.name === el.name) === i) }
    : input.frame;
  const frame = frameElementsInsideSafeMargin(frameInput);
  const heroMeasured = input.hero && !input.hero.degraded;
  const heroOk = heroMeasured && input.hero?.matches === true;
  const textMeasured = !input.text.degraded;
  const typographySource = input.typographySource ?? "textless_art_plus_svg_overlay";
  const rawArtOk = typographySource === "textless_art_plus_svg_overlay" ? !hasRawArtText(input) : true;
  const blankFallback = input.artwork?.blank_background === true
    || (input.artwork?.used_svg_fallback === true && input.artwork?.synthesized_background === true);
  const qualityOk = input.quality
    ? input.quality.produced_bytes === true && input.quality.luminance_dead !== true && Number(input.quality.byte_size ?? 0) > 1024
    : true;
  const hard_fail = {
    random_text: unapprovedText.length > 0 || !rawArtOk ? 1 : 0,
    out_of_category_object: heroOk ? 0 : 1,
    clipped_overlay: frame.pass ? 0 : 1,
    blank_background: blankFallback ? 1 : 0,
  };
  return {
    version: MEASURED_COVER_GATE_VERSION,
    cover_category_match: heroOk ? 99 : 0,
    title_readability: textMeasured && unapprovedText.length === 0 ? 99 : 0,
    cover_quality: frame.pass && input.logo.present && qualityOk && !blankFallback ? 95 : 0,
    age_label_present: normalizeCoverText(input.ageBadge).length > 0,
    logo_present: input.logo.present === true,
    page_count_matches_final_pdf: input.pageCountMatchesFinalPdf,
    hard_fail,
    evidence: {
      unapproved_text: unapprovedText,
      clipped_overlay: frame.clipped,
      hero_ok: heroOk,
      text_measured: textMeasured,
      exact_transcription: evaluateExactCoverTranscription(input),
      raw_art_textless: rawArtOk,
      typography_source: typographySource,
      blank_fallback: blankFallback,
    },
  };
}
