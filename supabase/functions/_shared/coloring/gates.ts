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
    anatomy_correctness: 95,       // NEW — customer-visible #1 defect class
    colorability: 92,              // NEW — enclosed regions must be colorable
  },
  cover: {
    cover_category_match: 98,
    title_readability: 95,
    cover_quality: 92,
  },
  release: {
    final_sellable: 92,
    book_weighted_avg: 92,
    per_page_floor: 88,
    max_duplicate_scene_rate: 0.05,
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
  "anatomy_defect",         // NEW — extra/missing/fused/malformed limbs, fingers, faces, wings, tails
  "large_solid_black_area", // NEW — filled black regions kill colorable space
  "copyrighted_ip",         // NEW — recognizable IP / living-artist style imitation
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
  anatomy_correctness: number;
  colorability: number;
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

// Book-level weighted acceptance (7 dimensions + book gates).
// Weights sum to 100. Never lowered without owner-approved policy change.
export const COLORING_BOOK_WEIGHTS = {
  theme_fit: 15,
  age_fit: 15,
  anatomy_correctness: 15,
  line_art_cleanliness: 15,
  colorability: 10,
  composition_margins: 10,
  visual_appeal: 10,
  originality_diversity: 5,
  style_consistency: 5,
} as const;

export interface ColoringBookScorecard {
  theme_fit: number;
  age_fit: number;
  anatomy_correctness: number;
  line_art_cleanliness: number;
  colorability: number;
  composition_margins: number;
  visual_appeal: number;
  originality_diversity: number;
  style_consistency: number;
  per_page_scores: number[];       // final composite per page
  hard_fails_total: number;
  duplicate_scene_rate: number;    // 0..1
  spelling_ok: boolean;            // typography layer — must be 100% clean
}

export interface WeightedBookGateResult extends GateResult {
  weighted_avg: number;
}

export function coloringBookWeightedGate(s: ColoringBookScorecard): WeightedBookGateResult {
  const w = COLORING_BOOK_WEIGHTS;
  const weighted_avg =
    (s.theme_fit * w.theme_fit +
      s.age_fit * w.age_fit +
      s.anatomy_correctness * w.anatomy_correctness +
      s.line_art_cleanliness * w.line_art_cleanliness +
      s.colorability * w.colorability +
      s.composition_margins * w.composition_margins +
      s.visual_appeal * w.visual_appeal +
      s.originality_diversity * w.originality_diversity +
      s.style_consistency * w.style_consistency) / 100;
  const reasons: string[] = [];
  if (weighted_avg < COLORING_TH.release.book_weighted_avg)
    reasons.push(`weighted_avg=${weighted_avg.toFixed(1)} < ${COLORING_TH.release.book_weighted_avg}`);
  const minPage = s.per_page_scores.length ? Math.min(...s.per_page_scores) : 0;
  if (minPage < COLORING_TH.release.per_page_floor)
    reasons.push(`min_page_score=${minPage} < ${COLORING_TH.release.per_page_floor}`);
  if (s.hard_fails_total > 0)
    reasons.push(`hard_fails_total=${s.hard_fails_total} > 0`);
  if (s.duplicate_scene_rate > COLORING_TH.release.max_duplicate_scene_rate)
    reasons.push(`duplicate_scene_rate=${s.duplicate_scene_rate} > ${COLORING_TH.release.max_duplicate_scene_rate}`);
  if (!s.spelling_ok)
    reasons.push(`spelling_ok=false (cover/typography must be 100%)`);
  return { pass: reasons.length === 0, reasons, weighted_avg };
}

export interface ColoringCoverScorecard {
  cover_category_match: number;
  title_readability: number;
  cover_quality: number;
  age_label_present: boolean;
  logo_present: boolean;
  page_count_matches_final_pdf: boolean;
  hard_fail: Partial<Record<"watermark" | "random_text" | "out_of_category_object" | "clipped_overlay" | "blank_background", number>>;
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
  if (!s.logo_present) reasons.push("logo_present=false");
  if (!s.page_count_matches_final_pdf) reasons.push("page_count_matches_final_pdf=false");
  const hf = s.hard_fail ?? {};
  if ((hf.watermark ?? 0) > 0) reasons.push(`hard_fail:watermark=${hf.watermark}`);
  if ((hf.random_text ?? 0) > 0) reasons.push(`hard_fail:random_text=${hf.random_text}`);
  if ((hf.out_of_category_object ?? 0) > 0) reasons.push(`hard_fail:out_of_category_object=${hf.out_of_category_object}`);
  if ((hf.clipped_overlay ?? 0) > 0) reasons.push(`hard_fail:clipped_overlay=${hf.clipped_overlay}`);
  if ((hf.blank_background ?? 0) > 0) reasons.push(`hard_fail:blank_background=${hf.blank_background}`);
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
  book_weighted_gate_pass: boolean; // NEW
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
    ["book_weighted_gate_pass", "book-level weighted acceptance failed"],
  ];
  for (const [k, msg] of flags) if (!x[k]) reasons.push(msg);
  if (x.final_sellable < COLORING_TH.release.final_sellable) {
    reasons.push(`final_sellable=${x.final_sellable} < ${COLORING_TH.release.final_sellable}`);
  }
  return { pass: reasons.length === 0, reasons };
}
