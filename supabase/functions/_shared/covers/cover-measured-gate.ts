// Pure measured cover-gate helpers. Runtime vision callers persist the raw
// OCR/hero/logo/frame evidence; these functions convert that evidence into
// the scorecard consumed by coloringCoverGate. No constants-as-gates.

export interface CoverTextEvidence {
  detected_text?: string | null;
  has_glyphs?: boolean;
  degraded?: boolean;
}

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
  hero?: CoverHeroEvidence | null;
  frame: CoverFrameEvidence;
  logo: CoverLogoEvidence;
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
  for (const raw of [input.title, input.subtitle ?? "", input.ageBadge ?? "", "secretpdf kids", "secretpdf", "secretpdf co"]) {
    const n = normalizeCoverText(raw);
    if (n) out.add(n);
  }
  return out;
}

export function findUnapprovedCoverText(input: Pick<MeasuredCoverGateInput, "title" | "subtitle" | "ageBadge" | "text">): string[] {
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

export function measuredCoverScorecard(input: MeasuredCoverGateInput) {
  const unapprovedText = findUnapprovedCoverText(input);
  const frame = frameElementsInsideSafeMargin(input.frame);
  const heroMeasured = input.hero && !input.hero.degraded;
  const heroOk = !heroMeasured || input.hero?.matches === true;
  const textMeasured = !input.text.degraded;
  const qualityOk = input.quality
    ? input.quality.produced_bytes === true && input.quality.luminance_dead !== true && Number(input.quality.byte_size ?? 0) > 1024
    : true;
  const hard_fail = {
    random_text: unapprovedText.length > 0 ? 1 : 0,
    out_of_category_object: heroOk ? 0 : 1,
    clipped_overlay: frame.pass ? 0 : 1,
  };
  return {
    cover_category_match: heroOk ? 99 : 0,
    title_readability: textMeasured && unapprovedText.length === 0 ? 99 : 0,
    cover_quality: frame.pass && input.logo.present && qualityOk ? 95 : 0,
    age_label_present: normalizeCoverText(input.ageBadge).length > 0,
    logo_present: input.logo.present === true,
    page_count_matches_final_pdf: input.pageCountMatchesFinalPdf,
    hard_fail,
    evidence: {
      unapproved_text: unapprovedText,
      clipped_overlay: frame.clipped,
      hero_ok: heroOk,
      text_measured: textMeasured,
    },
  };
}
