// Age-band defaults library. One place to look up the LineArtStyleContract
// baseline for a target age. Concept generation + category seeding read from
// this so new categories don't drift from house standards.
//
// Calibration principle (owner directive, 2026-07-19 six-band wave):
// line thickness DESCENDS with age, subject scale DESCENDS with age, and
// detail density + background complexity ASCEND with age. Each band gets
// its OWN tuned values — bands are never aliased to a neighbour to "unpark"
// a book. Every DB-band listed on the admin picker must have a distinct
// calibrated contract in STYLE_CONTRACT_FOR_DB_BAND below.

import type { LineArtStyleContract } from "./style-contract.ts";

export type AgeBandKey = "2-4" | "3-5" | "4-6" | "6-8" | "8-12" | "teen_adult";

export const AGE_BAND_DEFAULTS: Record<AgeBandKey, LineArtStyleContract> = {
  // 2-3 yrs — toddler. Extra-thick 8-12px equivalent, ONE huge subject,
  // no background, chubby forms, largest closed regions on the shelf.
  "2-4": {
    style_family: "toddler_giant_shapes",
    line_thickness: "extra_thick",
    eye_style: "very simple round with dot pupils, joyful expression",
    realism_level: "cartoon",
    proportion_family: "chubby_toddler_friendly",
    curve_softness: "soft",
    background_complexity: "none",
    detail_density: "low",
    border_treatment: "safe_margin",
    subject_scale_pct: [70, 90],
    white_space_balance: "generous",
    style_prompt_snippet:
      "Toddler coloring-book page for ages 2-3. ONE huge subject centered on the page. " +
      "Extra-thick smooth black contour lines (8-12px equivalent), chubby rounded forms, " +
      "extremely large closed coloring spaces, absolutely no interior shading, " +
      "absolutely no background elements, pure white background",
  },
  // 3-5 yrs — preschool. Still extra-thick lines but the composition can
  // carry a single companion element (one flower, one ball) and slightly
  // more expressive faces. NOT a copy of 4-6 with a smaller number.
  "3-5": {
    style_family: "preschool_thick_line_simple",
    line_thickness: "extra_thick",
    eye_style: "simple round with dot pupils, happy expressive face",
    realism_level: "cartoon",
    proportion_family: "chubby_toddler_friendly",
    curve_softness: "soft",
    background_complexity: "none",
    detail_density: "low",
    border_treatment: "safe_margin",
    subject_scale_pct: [65, 85],
    white_space_balance: "generous",
    style_prompt_snippet:
      "Preschool coloring-book page for ages 3-5. ONE clear main subject with at most " +
      "ONE simple companion element (a ball, a flower, a small cloud). Extra-thick smooth " +
      "black contour lines, rounded chubby forms, very large closed coloring spaces, " +
      "no interior shading or texture, no background scenery, pure white background",
  },
  // 4-6 yrs — early elementary. Thick lines, rounded forms, minimal
  // background. The historical house baseline.
  "4-6": {
    style_family: "clean_friendly_thick_line",
    line_thickness: "thick",
    eye_style: "simple round with dot pupils, friendly expression",
    realism_level: "cartoon",
    proportion_family: "rounded_child_friendly",
    curve_softness: "soft",
    background_complexity: "low",
    detail_density: "low",
    border_treatment: "safe_margin",
    subject_scale_pct: [60, 80],
    white_space_balance: "generous",
    style_prompt_snippet:
      "Clean friendly children's coloring-book line art for ages 4-6, thick smooth black " +
      "contour lines (roughly 5-7px equivalent), rounded forms, large closed coloring " +
      "spaces, minimal interior shading, simple expressive faces, small optional " +
      "background hint (one hill, one cloud), pure white background",
  },
  // 6-8 yrs — mid elementary. Medium 4-6px lines, moderate detail, a
  // readable environment (2-3 background elements), still every region
  // clearly enclosed and colorable.
  "6-8": {
    style_family: "playful_moderate_detail",
    line_thickness: "medium",
    eye_style: "expressive round eyes with brows",
    realism_level: "cartoon",
    proportion_family: "balanced_kid_friendly",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [50, 75],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Kid coloring-book page for ages 6-8, medium-weight clean black contour lines " +
      "(roughly 4-6px equivalent), moderate scene detail with 2-3 readable background " +
      "elements, clear closed regions throughout, simple decorative accents (spots, " +
      "stripes) as line art only, no letters, pure white background",
  },
  // 8-12 yrs — tween. Finer lines than 6-8, controlled patterned elements
  // (scales, feathers, brickwork rendered as line art), richer scene
  // composition. Still 100% enclosed regions — no solid fills.
  "8-12": {
    style_family: "tween_fine_line_patterned",
    line_thickness: "medium",
    eye_style: "expressive detailed but clean line",
    realism_level: "stylized",
    proportion_family: "balanced",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [45, 70],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Coloring-book page for tweens ages 8-12, finer clean black contour lines " +
      "(roughly 3-4px equivalent) than younger bands, richer scene composition with " +
      "layered mid- and background elements, controlled patterned detail (scales, " +
      "feathers, leaf veins, brickwork, fabric folds) rendered strictly as line art, " +
      "every enclosed region colorable, absolutely no solid-black fills, pure white background",
  },
  // 13-17 yrs — teen / young adult. Fine intricate lines, mandala-class
  // symmetry and pattern density in decorative bands. Every micro-region
  // still closed and colorable.
  teen_adult: {
    style_family: "teen_intricate_mandala_class",
    line_thickness: "thin",
    eye_style: "detailed but line-clean, expressive",
    realism_level: "semi-realistic",
    proportion_family: "realistic",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [40, 65],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Teen / young-adult coloring-book page for ages 13-17, fine intricate black " +
      "line work (roughly 1.5-2.5px equivalent), mandala-class symmetry and dense " +
      "decorative pattern bands (radial motifs, zentangle-style pattern fills, " +
      "geometric borders), every micro-region enclosed and colorable, absolutely " +
      "no solid-black fills, controlled pattern density that stays readable, " +
      "pure white background",
  },
};

export function ageBandForAges(minAge: number, maxAge: number): AgeBandKey {
  const mid = (minAge + maxAge) / 2;
  if (mid < 3) return "2-4";
  if (mid < 4) return "3-5";
  if (mid < 6) return "4-6";
  if (mid < 8) return "6-8";
  if (mid < 13) return "8-12";
  return "teen_adult";
}

/**
 * Normalize an admin-picker age slug (which mirrors the storefront chip set:
 * 2-4, 4-6, 6-8, 8-12, 13-17, all_ages, plus legacy 3-5) to a concrete
 * AgeBandKey used by the style-contract library.
 */
export function normalizeAdminAgeBand(slug: string | null | undefined): AgeBandKey {
  switch ((slug ?? "").toLowerCase()) {
    case "2-4": return "2-4";
    case "3-5": return "3-5";
    case "4-6": return "4-6";
    case "6-8": return "6-8";
    case "8-12": return "8-12";
    case "13-17": return "teen_adult";
    case "all_ages": return "4-6";
    default: return "4-6";
  }
}

export function defaultStyleForAges(minAge: number, maxAge: number): LineArtStyleContract {
  return AGE_BAND_DEFAULTS[ageBandForAges(minAge, maxAge)];
}

/**
 * Explicit DB-band → calibrated-contract map. Every band on the admin
 * picker must map to a distinct tuned contract in AGE_BAND_DEFAULTS.
 * A `null` entry means the pipeline MUST park with
 * blocker_reason='band_defaults_missing' rather than silently fall back
 * to another band. (Owner directive, 2026-07-19 six-band wave.)
 */
export const STYLE_CONTRACT_FOR_DB_BAND: Record<string, AgeBandKey | null> = {
  "2_3":    "2-4",
  "3_5":    "3-5",
  "4_6":    "4-6",
  "6_8":    "6-8",
  "8_12":   "8-12",
  "13_17":  "teen_adult",
  "18_plus":"teen_adult",
  "60_plus":"teen_adult",
  "all_ages": null,         // multi-band bundle needs its own contract → PARK
};

export function resolveStyleContractForDbBand(
  bandKey: string | null | undefined,
): { contract: LineArtStyleContract; band_key: AgeBandKey } | null {
  const mapped = STYLE_CONTRACT_FOR_DB_BAND[String(bandKey ?? "").toLowerCase()];
  if (!mapped) return null;
  return { contract: AGE_BAND_DEFAULTS[mapped], band_key: mapped };
}
