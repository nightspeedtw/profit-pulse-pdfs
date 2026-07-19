// COLORING RULEBOOK v2 — "ESSENTIALS ONLY" (2026-07-19 amendment).
//
// A coloring book has NO story. Over-gating on per-page 95/98 thresholds,
// weighted book scores, uniqueness dHash, anatomy scores, category presence
// prominence, etc. caused false rejections and cover-retry spend storms.
//
// Under v2, the coloring lane enforces exactly three essentials:
//   1. Catchy, parent-buyable title (checked at intake).
//   2. Cover title spelling correct — NON-WAIVABLE (owner law).
//   3. Cover matches the interior (cover-last, interiors as reference).
//
// Everything else is advisory / auto-enhance, NOT release-blocking.
// The v1 API surface is preserved so existing call sites keep compiling;
// thresholds and hard-fail keys are simply narrowed to the garbage floor.
//
// This module MUST NEVER be invoked from a non-coloring lane row.

export const COLORING_RULEBOOK_GATES_VERSION = "coloring_rulebook_v2_essentials_only";

// v2: only a garbage floor. Anything above these numbers ships.
export const COLORING_TH = {
  page: {
    line_art_cleanliness: 70,
    printability: 70,
  },
  cover: {
    title_readability: 85,
  },
  release: {
    final_sellable: 0, // release readiness comes from the essentials, not a score
  },
} as const;

// v2: reduced hard-fail set. Only artifacts that make the page unsellable
// or legally unsafe cause a reject. Duplicates / anatomy / out-of-category
// / cropped-subject / grayscale / solid-black are ADVISORY under the
// coloring rulebook amendments (they log to defect_ledger but do not block).
export const COLORING_HARD_FAIL_ZERO_KEYS = [
  "watermark",
  "random_text",
  "signature",
  "copyrighted_ip",
  "invalid_svg",
  "garbage_image_broken",
] as const;

export type ColoringHardFailKey = (typeof COLORING_HARD_FAIL_ZERO_KEYS)[number];

export interface ColoringPageScorecard {
  category_match?: number;
  age_complexity_match?: number;
  line_art_cleanliness?: number;
  style_consistency?: number;
  printability?: number;
  safe_margin?: number;
  white_background?: number;
  visual_uniqueness?: number;
  anatomy_correctness?: number;
  colorability?: number;
  hard_fail?: Partial<Record<string, number>>;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
}

export function coloringPageGate(s: Partial<ColoringPageScorecard>): GateResult {
  const reasons: string[] = [];
  const th = COLORING_TH.page;
  if ((s.line_art_cleanliness ?? 100) < th.line_art_cleanliness)
    reasons.push(`line_art_cleanliness=${s.line_art_cleanliness} < ${th.line_art_cleanliness}`);
  if ((s.printability ?? 100) < th.printability)
    reasons.push(`printability=${s.printability} < ${th.printability}`);
  const hf = s.hard_fail ?? {};
  for (const k of COLORING_HARD_FAIL_ZERO_KEYS) {
    const v = hf[k] ?? 0;
    if (v > 0) reasons.push(`hard_fail:${k}=${v}`);
  }
  return { pass: reasons.length === 0, reasons };
}

// v1 weights preserved so callers that still compute weighted_avg get a
// stable number for `overall_qc_score` display. They no longer gate release.
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
  per_page_scores: number[];
  hard_fails_total: number;
  duplicate_scene_rate: number;
  spelling_ok: boolean;
}

export interface WeightedBookGateResult extends GateResult {
  weighted_avg: number;
}

// v2: thin book gate. Only `spelling_ok === false` blocks. The weighted
// average is still returned for display / analytics.
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
  if (!s.spelling_ok) reasons.push("spelling_ok=false (cover typography must be 100%)");
  return { pass: reasons.length === 0, reasons, weighted_avg };
}

export interface ColoringCoverScorecard {
  cover_category_match?: number;
  title_readability?: number;
  cover_quality?: number;
  age_label_present?: boolean;
  logo_present?: boolean;
  page_count_matches_final_pdf?: boolean;
  spelling_ok?: boolean;
  cover_interior_match?: number; // v2 rule #3 — advisory unless <50
  hard_fail?: Partial<Record<string, number>>;
}

// v2: cover gate reduced to the three essentials.
//   * spelling_ok is NON-WAIVABLE (owner law, spelling_only_critical_unpublish_v1)
//   * title_readability >= 85
//   * cover_interior_match — soft reject only if catastrophically low (<50)
// Hard-fail set = watermark / random_text / copyrighted_ip only.
export function coloringCoverGate(s: Partial<ColoringCoverScorecard>): GateResult {
  const reasons: string[] = [];
  const th = COLORING_TH.cover;
  if (s.spelling_ok === false) {
    reasons.push("spelling_ok=false (NON-WAIVABLE cover typography law)");
  }
  if ((s.title_readability ?? 100) < th.title_readability)
    reasons.push(`title_readability=${s.title_readability} < ${th.title_readability}`);
  if (typeof s.cover_interior_match === "number" && s.cover_interior_match < 50)
    reasons.push(`cover_interior_match=${s.cover_interior_match} < 50 (catastrophic mismatch)`);
  const hf = s.hard_fail ?? {};
  if ((hf.watermark ?? 0) > 0) reasons.push(`hard_fail:watermark=${hf.watermark}`);
  if ((hf.random_text ?? 0) > 0) reasons.push(`hard_fail:random_text=${hf.random_text}`);
  if ((hf.copyrighted_ip ?? 0) > 0) reasons.push(`hard_fail:copyrighted_ip=${hf.copyrighted_ip}`);
  return { pass: reasons.length === 0, reasons };
}

export interface ColoringReleaseInput {
  all_pages_in_category?: boolean;
  age_complexity_ok?: boolean;
  style_locked_throughout?: boolean;
  all_pages_unique?: boolean;
  pdf_opens: boolean;
  pdf_page_count_matches?: boolean;
  cover_gate_pass: boolean;
  zero_prohibited_artifacts: boolean;
  commercial_rights_pass?: boolean;
  final_sellable?: number;
  book_weighted_gate_pass?: boolean;
}

// v2 release gate: only the three commerce-integrity essentials.
//   * pdf_opens (bytes present, sha exists)
//   * cover_gate_pass (spelling + readability + interior match — see above)
//   * zero_prohibited_artifacts (spelling + copyrighted_ip clean)
export function coloringReleaseGate(x: ColoringReleaseInput): GateResult {
  const reasons: string[] = [];
  if (!x.pdf_opens) reasons.push("pdf_opens=false");
  if (!x.cover_gate_pass) reasons.push("cover_gate_pass=false");
  if (!x.zero_prohibited_artifacts) reasons.push("zero_prohibited_artifacts=false");
  return { pass: reasons.length === 0, reasons };
}
