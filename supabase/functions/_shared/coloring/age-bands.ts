// Age-band defaults library. One place to look up the LineArtStyleContract
// baseline for a target age. Concept generation + category seeding read from
// this so new categories don't drift from house standards.

import type { LineArtStyleContract } from "./style-contract.ts";

export type AgeBandKey = "2-4" | "4-6" | "6-8" | "8-12" | "teen_adult";

export const AGE_BAND_DEFAULTS: Record<AgeBandKey, LineArtStyleContract> = {
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
      "Toddler coloring-book page. ONE huge subject centered. Very thick smooth black contour lines, extremely large closed coloring spaces, no interior shading, no background clutter, pure white background",
  },
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
      "Clean friendly children's coloring-book line art, thick smooth black contour lines, rounded forms, large closed coloring spaces, minimal interior shading, simple expressive faces, pure white background",
  },
  "6-8": {
    style_family: "playful_moderate_detail",
    line_thickness: "medium",
    eye_style: "expressive round eyes",
    realism_level: "cartoon",
    proportion_family: "balanced_kid_friendly",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [50, 75],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Kid coloring-book page for ages 6-8, medium-weight clean black contour lines, moderate scene detail with clear closed regions, simple readable background elements, occasional educational labels ok as line art shapes (no letters), pure white background",
  },
  "8-12": {
    style_family: "rich_controlled_detail",
    line_thickness: "medium",
    eye_style: "expressive detailed but clean",
    realism_level: "stylized",
    proportion_family: "balanced",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [45, 70],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Coloring-book page for tweens, richer scene composition, clean medium-weight black contour lines, controlled detail density, every enclosed region colorable, pure white background",
  },
  teen_adult: {
    style_family: "intricate_line_clarity",
    line_thickness: "thin",
    eye_style: "detailed but line-clean",
    realism_level: "semi-realistic",
    proportion_family: "realistic",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [40, 75],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Adult coloring-book page, intricate but exceptionally clean black line work, every region enclosed and colorable, no solid-black fills, controlled pattern density, pure white background",
  },
};

export function ageBandForAges(minAge: number, maxAge: number): AgeBandKey {
  const mid = (minAge + maxAge) / 2;
  if (mid < 4) return "2-4";
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
    case "3-5": return "4-6";
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
 * Explicit DB-band → calibrated-contract map. Honest: only bands that have
 * a distinct, tuned contract in AGE_BAND_DEFAULTS appear here. Anything not
 * mapped MUST park with blocker_reason='band_defaults_missing' — never
 * silently fall back to 4_6. (Owner directive, 2026-07-19 age-band wave.)
 */
export const STYLE_CONTRACT_FOR_DB_BAND: Record<string, AgeBandKey | null> = {
  "2_3":    "2-4",          // extra-thick minimal (nearest calibrated band)
  "3_5":    null,           // no distinct preschool contract yet → PARK
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
