// QC gates for coloring-book pages, cover, and release. Thresholds are
// non-negotiable — do NOT lower without owner-approved policy change.

export const COLORING_TH = {
  page: {
    category_match: 98,
    age_complexity_match: 95,
    line_art_cleanliness: 98,
    style_consistency: 95,
    printability: 98,
    safe_margin: 100,
    white_background: 100,
    visual_uniqueness: 90,
  },
  cover: {
    cover_category_match: 98,
    title_readability: 95,
    cover_quality: 92,
  },
  release: {
    final_sellable: 92,
  },
} as const;

// Any of these being > 0 hard-fails the page regardless of other scores.
export const COLORING_HARD_FAIL_ZERO_KEYS = [
  "watermark",
  "random_text",
  "signature",
  "grayscale_area",
  "cropped_subject",
  "out_of_category_object",
  "duplicate_page",
  "duplicate_image_hash",
  "invalid_svg",
] as const;

export type ColoringHardFailKey = (typeof COLORING_HARD_FAIL_ZERO_KEYS)[number];

export interface ColoringPageScorecard {
  category_match: number;
  age_complexity_match: number;
  line_art_cleanliness: number;
  style_consistency: number;
  printability: number;
  safe_margin: number;
  white_background: number;
  visual_uniqueness: number;
  hard_fail: Partial<Record<ColoringHardFailKey, number>>;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
}

export function coloringPageGate(s: Partial<ColoringPageScorecard>): GateResult {
  const reasons: string[] = [];
  const th = COLORING_TH.page;
  const check = (k: keyof typeof th) => {
    const v = (s as any)[k] ?? 0;
    if (v < th[k]) reasons.push(`${k}=${v} < ${th[k]}`);
  };
  (Object.keys(th) as (keyof typeof th)[]).forEach(check);
  const hf = s.hard_fail ?? {};
  for (const k of COLORING_HARD_FAIL_ZERO_KEYS) {
    const v = hf[k] ?? 0;
    if (v > 0) reasons.push(`hard_fail:${k}=${v}`);
  }
  return { pass: reasons.length === 0, reasons };
}

export interface ColoringCoverScorecard {
  cover_category_match: number;
  title_readability: number;
  cover_quality: number;
  age_label_present: boolean;
  page_count_matches_final_pdf: boolean;
  hard_fail: Partial<Record<"watermark" | "random_text", number>>;
}

export function coloringCoverGate(s: Partial<ColoringCoverScorecard>): GateResult {
  const reasons: string[] = [];
  const th = COLORING_TH.cover;
  if ((s.cover_category_match ?? 0) < th.cover_category_match)
    reasons.push(`cover_category_match=${s.cover_category_match ?? 0} < ${th.cover_category_match}`);
  if ((s.title_readability ?? 0) < th.title_readability)
    reasons.push(`title_readability=${s.title_readability ?? 0} < ${th.title_readability}`);
  if ((s.cover_quality ?? 0) < th.cover_quality)
    reasons.push(`cover_quality=${s.cover_quality ?? 0} < ${th.cover_quality}`);
  if (!s.age_label_present) reasons.push("age_label_present=false");
  if (!s.page_count_matches_final_pdf) reasons.push("page_count_matches_final_pdf=false");
  const hf = s.hard_fail ?? {};
  if ((hf.watermark ?? 0) > 0) reasons.push(`hard_fail:watermark=${hf.watermark}`);
  if ((hf.random_text ?? 0) > 0) reasons.push(`hard_fail:random_text=${hf.random_text}`);
  return { pass: reasons.length === 0, reasons };
}

export interface ColoringReleaseInput {
  all_pages_in_category: boolean;
  age_complexity_ok: boolean;
  style_locked_throughout: boolean;
  all_pages_unique: boolean;
  pdf_opens: boolean;
  pdf_page_count_matches: boolean;
  cover_gate_pass: boolean;
  zero_prohibited_artifacts: boolean;
  commercial_rights_pass: boolean;
  final_sellable: number;
}

export function coloringReleaseGate(x: ColoringReleaseInput): GateResult {
  const reasons: string[] = [];
  const flags: [keyof ColoringReleaseInput, string][] = [
    ["all_pages_in_category", "some pages outside category"],
    ["age_complexity_ok", "age complexity not met"],
    ["style_locked_throughout", "style not locked across pages"],
    ["all_pages_unique", "duplicate pages present"],
    ["pdf_opens", "final PDF does not open"],
    ["pdf_page_count_matches", "PDF page count mismatch"],
    ["cover_gate_pass", "cover gate failed"],
    ["zero_prohibited_artifacts", "prohibited artifacts present"],
    ["commercial_rights_pass", "commercial rights manifest failed"],
  ];
  for (const [k, msg] of flags) if (!x[k]) reasons.push(msg);
  if (x.final_sellable < COLORING_TH.release.final_sellable) {
    reasons.push(`final_sellable=${x.final_sellable} < ${COLORING_TH.release.final_sellable}`);
  }
  return { pass: reasons.length === 0, reasons };
}
