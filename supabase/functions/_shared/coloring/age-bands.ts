// Age-band defaults + FULL band profiles. One place to look up everything
// that changes with reader age: line-art style contract, cover art direction,
// theme hints, forbidden themes, default page count, and marketing tone.
//
// Owner directive (2026-07-19 six-band wave, expanded 2026-07-20):
// Line thickness alone is NOT an age contract. Art STYLE, THEMES, COVER
// treatment, page count, and marketing tone must all mature with the reader.
// Every DB band on the admin picker MUST have a distinct, calibrated
// profile — no aliasing to a neighbour to "unpark" a book.
//
// The five bands the owner explicitly re-specified (2_3, 3_5, 6_8, 8_12,
// 13_17) are rewritten as full profiles below. 4_6 keeps its historical
// baseline as the mid-elementary anchor.

import type { LineArtStyleContract } from "./style-contract.ts";

export type AgeBandKey = "2-4" | "3-5" | "4-6" | "6-8" | "8-12" | "teen_adult";

export const AGE_BAND_DEFAULTS: Record<AgeBandKey, LineArtStyleContract> = {
  // 2-3 yrs — toddler / board-book style. 5-8px lines, ONE huge subject,
  // zero background, ultra-simple rounded baby proportions.
  "2-4": {
    style_family: "toddler_board_book",
    line_thickness: "extra_thick",
    eye_style: "very simple round with dot pupils, joyful expression",
    realism_level: "cartoon",
    proportion_family: "baby_proportion_board_book",
    curve_softness: "soft",
    background_complexity: "none",
    detail_density: "low",
    border_treatment: "safe_margin",
    subject_scale_pct: [75, 92],
    white_space_balance: "generous",
    style_prompt_snippet:
      "Toddler coloring-book page for ages 2-3 in ultra-simple board-book style. " +
      "ONE huge friendly subject centered on the page, drawn with ROUNDED BABY " +
      "PROPORTIONS (large heads, chubby limbs, tiny features). Extra-thick smooth " +
      "black contour lines (5-8px equivalent), enormous closed coloring spaces, " +
      "absolutely no interior shading, absolutely no background elements, no ground " +
      "line, pure white background",
  },
  // 3-5 yrs — preschool. 4-6px lines, 1-2 subjects + minimal ground line,
  // chubby friendly cartoon with simple faces.
  "3-5": {
    style_family: "preschool_chubby_cartoon",
    line_thickness: "thick",
    eye_style: "simple round with dot pupils, happy expressive face",
    realism_level: "cartoon",
    proportion_family: "chubby_preschool_friendly",
    curve_softness: "soft",
    background_complexity: "low",
    detail_density: "low",
    border_treatment: "safe_margin",
    subject_scale_pct: [60, 82],
    white_space_balance: "generous",
    style_prompt_snippet:
      "Preschool coloring-book page for ages 3-5 in chubby friendly cartoon style. " +
      "One main subject with AT MOST one companion element and a simple ground line " +
      "(grass, floor, or short horizon). Thick smooth black contour lines (4-6px " +
      "equivalent), rounded chubby forms, simple happy faces, generous closed " +
      "coloring spaces, no interior shading or texture, pure white background",
  },
  // 4-6 yrs — early elementary. Historical house baseline.
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
  // 6-8 yrs — mid elementary. 3-4px lines, subject + simple background scene,
  // standard kids-cartoon proportion (less chibi, more dynamic poses).
  "6-8": {
    style_family: "kids_dynamic_cartoon",
    line_thickness: "medium",
    eye_style: "expressive round eyes with brows, action-ready",
    realism_level: "cartoon",
    proportion_family: "standard_kid_cartoon_dynamic",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [50, 75],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Kid coloring-book page for ages 6-8 in standard kids-cartoon style with DYNAMIC " +
      "action-ready poses (less chibi, more athletic). Medium-weight clean black " +
      "contour lines (roughly 3-4px equivalent), full simple background scene with " +
      "2-3 readable environment elements, decorative line-art accents (spots, stripes, " +
      "motion lines), every enclosed region colorable, no solid-black fills, pure white background",
  },
  // 8-12 yrs — TWEEN. Critical: NOT babyish. 2-3px fine lines, full scenes
  // with backgrounds + patterned elements, semi-stylized art (manga-lite /
  // graphic-novel adjacent OK, no toddler-cute).
  "8-12": {
    style_family: "tween_semi_stylized_graphic",
    line_thickness: "medium",
    eye_style: "semi-stylized manga-lite eyes, expressive but clean line",
    realism_level: "stylized",
    proportion_family: "tween_semi_realistic",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [45, 70],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Tween coloring-book page for ages 8-12 in SEMI-STYLIZED graphic-novel / " +
      "manga-lite line art — absolutely NOT toddler-cute, NOT chibi, NOT chubby " +
      "baby proportions. Fine clean black contour lines (roughly 2-3px equivalent), " +
      "full scene with layered mid- and background elements, patterned decorative " +
      "detail (scales, feathers, fabric folds, brick, foliage) rendered strictly as " +
      "line art, controlled 'stress-relief' pattern density, every enclosed region " +
      "colorable, no solid-black fills, pure white background",
  },
  // 13-17 yrs — teen / young adult. 1-2px intricate lines, mandala /
  // botanical / pattern-heavy, adult-coloring-adjacent sophistication.
  teen_adult: {
    style_family: "teen_intricate_adult_adjacent",
    line_thickness: "thin",
    eye_style: "detailed but line-clean, expressive, sophisticated",
    realism_level: "semi-realistic",
    proportion_family: "realistic_stylized",
    curve_softness: "medium",
    background_complexity: "medium",
    detail_density: "medium",
    border_treatment: "safe_margin",
    subject_scale_pct: [40, 65],
    white_space_balance: "balanced",
    style_prompt_snippet:
      "Teen / young-adult coloring-book page for ages 13-17 in ADULT-COLORING-ADJACENT " +
      "sophisticated style with teen-trendy motifs. Fine intricate black line work " +
      "(roughly 1-2px equivalent), mandala-class symmetry, dense botanical / geometric / " +
      "zentangle pattern bands, aesthetic composition (cottagecore, gothic-cozy, " +
      "geometric are all valid registers), every micro-region enclosed and colorable, " +
      "no solid-black fills, pure white background",
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

// ============================================================================
// FULL BAND PROFILES (owner directive 2026-07-20)
// ============================================================================
// Every generation surface reads from AGE_BAND_PROFILE. Interior style comes
// from AGE_BAND_DEFAULTS above; the profile adds cover direction, theme
// hints, forbidden themes, page-count default, and marketing tone.

export type MarketingTone =
  | "parent_reassuring_toddler"
  | "parent_reassuring_preschool"
  | "kid_adventure"
  | "tween_not_for_little_kids"
  | "teen_mindful_aesthetic";

export interface AgeBandProfile {
  db_band: string;                       // "2_3" | "3_5" | "4_6" | ...
  contract_key: AgeBandKey;              // key into AGE_BAND_DEFAULTS
  label: string;                         // human label
  age_range: [number, number];
  page_count_default: number;
  page_count_range: [number, number];
  /** Verbal art-style description repeated everywhere — interior + cover + copy. */
  art_style_language: string;
  /** Extra cover-only art-direction clause appended to the cover prompt. */
  cover_art_direction: string;
  /** Extra NEGATIVE clause enforced on covers ("no baby-cute mascots" etc). */
  cover_forbidden_language: string;
  /** Concrete on-band theme hints for concept + category seeding. */
  theme_hints: string[];
  /** Themes that must NOT appear in this band (soft coverage-gate signal). */
  forbidden_themes: string[];
  /** Marketing tone selector for sales-copy generation. */
  marketing_tone: MarketingTone;
  /** Short marketing tagline template. */
  marketing_tagline: string;
}

export const AGE_BAND_PROFILE: Record<string, AgeBandProfile> = {
  "2_3": {
    db_band: "2_3",
    contract_key: "2-4",
    label: "Toddlers (2-3)",
    age_range: [2, 3],
    page_count_default: 22,
    page_count_range: [20, 24],
    art_style_language:
      "board-book style, ultra-simple rounded baby-proportion cartoon, extra-thick lines, one huge subject per page",
    cover_art_direction:
      "Bright PRIMARY-COLOR palette (red, yellow, blue, green). ONE big friendly character FACE fills the cover, " +
      "board-book styling, chunky rounded shapes, no small detail, no complex scene.",
    cover_forbidden_language:
      "NO tween aesthetics, NO manga eyes, NO edgy palette, NO intricate pattern, NO small text-like details.",
    theme_hints: [
      "first-word objects", "baby animals", "simple vehicles", "food items",
      "shapes and colors", "bath time", "family faces", "farm babies",
    ],
    forbidden_themes: [
      "dinosaurs with action", "adventure quests", "gaming", "mandalas",
      "mythology", "gothic", "cottagecore", "romance", "stress relief",
    ],
    marketing_tone: "parent_reassuring_toddler",
    marketing_tagline: "First coloring book — huge shapes, thick lines, made for tiny hands.",
  },
  "3_5": {
    db_band: "3_5",
    contract_key: "3-5",
    label: "Preschool (3-5)",
    age_range: [3, 5],
    page_count_default: 28,
    page_count_range: [24, 32],
    art_style_language:
      "chubby friendly cartoon with simple happy faces, thick lines, 1-2 subjects + minimal ground line",
    cover_art_direction:
      "Cheerful scene with 2-3 friendly characters, chunky preschool lettering styling (rendered by app overlay), " +
      "bright sunny palette, big smiling faces, simple ground line (grass or floor).",
    cover_forbidden_language:
      "NO manga/anime styling, NO tween or teen aesthetics, NO dark palette, NO intricate patterns.",
    theme_hints: [
      "farm animals", "pets", "community helpers", "simple stories",
      "vehicles", "dinosaurs (friendly)", "fairy tales", "seasons",
    ],
    forbidden_themes: [
      "mandalas", "gothic", "cottagecore", "gaming", "mythology",
      "romance", "stress relief",
    ],
    marketing_tone: "parent_reassuring_preschool",
    marketing_tagline: "Preschool coloring book — chunky lines, friendly faces, quiet-time hero.",
  },
  "4_6": {
    db_band: "4_6",
    contract_key: "4-6",
    label: "Early Elementary (4-6)",
    age_range: [4, 6],
    page_count_default: 32,
    page_count_range: [28, 36],
    art_style_language:
      "clean friendly children's cartoon, thick lines, single subject with minimal background hint",
    cover_art_direction:
      "Friendly scene with 3-5 characters, bold cheerful palette, clear focal subject, minimal background props.",
    cover_forbidden_language:
      "NO manga/tween aesthetics, NO intricate pattern, NO gothic/moody palette.",
    theme_hints: [
      "farm and woodland", "pets", "dinosaurs", "sea animals",
      "princesses and fairies", "unicorns", "seasonal holidays", "vehicles",
    ],
    forbidden_themes: [
      "mandalas (adult-class)", "gothic", "gaming-adjacent teen aesthetics", "romance",
    ],
    marketing_tone: "parent_reassuring_preschool",
    marketing_tagline: "Bold-line coloring book kids ages 4-6 actually finish.",
  },
  "6_8": {
    db_band: "6_8",
    contract_key: "6-8",
    label: "Kids (6-8)",
    age_range: [6, 8],
    page_count_default: 36,
    page_count_range: [32, 40],
    art_style_language:
      "standard kids-cartoon proportion with DYNAMIC action poses (less chibi), medium lines, full scene with simple background",
    cover_art_direction:
      "ACTION-ADVENTURE composition, dynamic camera angle, bolder saturated palette, hero pose, " +
      "readable environment (sky, ground, one prop), reads like a middle-grade adventure cover.",
    cover_forbidden_language:
      "NO baby-cute chibi mascots, NO board-book rounded proportions, NO toddler palette.",
    theme_hints: [
      "adventure", "dinosaurs with action", "space", "sports",
      "fantasy quests", "vehicles in action", "sea explorers", "superheroes (original)",
    ],
    forbidden_themes: [
      "baby-first-word objects", "board-book shapes", "mandalas", "romance",
    ],
    marketing_tone: "kid_adventure",
    marketing_tagline: "Action-packed coloring adventures for kids ages 6-8.",
  },
  "8_12": {
    db_band: "8_12",
    contract_key: "8-12",
    label: "Tweens (8-12)",
    age_range: [8, 12],
    page_count_default: 48,
    page_count_range: [40, 60],
    art_style_language:
      "SEMI-STYLIZED graphic-novel / manga-lite line art (absolutely NOT toddler-cute), fine lines, full scenes with patterned elements",
    cover_art_direction:
      "Reads like a TWEEN GRAPHIC NOVEL cover: semi-stylized manga-lite characters, dynamic composition, " +
      "muted-cool or vivid-trendy palette (kawaii-cool, gaming-adjacent, cool animals in cool settings), " +
      "'stress-relief' framing acceptable. Sophisticated but age-appropriate.",
    cover_forbidden_language:
      "NO baby-cute characters, NO chibi proportions, NO board-book rounded shapes, NO toddler primary-color " +
      "palette, NO preschool chunky lettering — this cover must NEVER read as a book for little kids.",
    theme_hints: [
      "kawaii-cool aesthetics", "gaming-adjacent originals", "animals in cool settings",
      "simple mandalas", "stress-relief patterns", "fantasy worlds",
      "manga-lite characters", "trendy foods and fashion",
    ],
    forbidden_themes: [
      "baby-first-word objects", "board-book shapes", "toddler animals with baby proportions",
      "preschool community helpers", "chibi mascots",
    ],
    marketing_tone: "tween_not_for_little_kids",
    marketing_tagline: "A coloring book that finally isn't babyish — for tweens 8-12.",
  },
  "13_17": {
    db_band: "13_17",
    contract_key: "teen_adult",
    label: "Teens (13-17)",
    age_range: [13, 17],
    page_count_default: 55,
    page_count_range: [50, 60],
    art_style_language:
      "ADULT-COLORING-ADJACENT sophisticated line work, intricate 1-2px lines, mandala / botanical / pattern-heavy composition",
    cover_art_direction:
      "Looks like an ADULT COLORING BOOK with teen-trendy styling. Aesthetic registers include cottagecore, " +
      "gothic-cozy, geometric, botanical, mindful/mandala. Muted sophisticated palette, intricate hero motif, " +
      "reads like a self-care / mindfulness title on a bookshop table.",
    cover_forbidden_language:
      "NO cartoon mascots, NO chibi, NO baby-cute characters, NO primary-color toddler palette, " +
      "NO preschool styling.",
    theme_hints: [
      "cottagecore aesthetics", "gothic-cozy", "geometric mandalas",
      "botanical florals", "mindfulness motifs", "celestial",
      "fashion illustration", "zentangle patterns",
    ],
    forbidden_themes: [
      "toddler animals", "baby-first-word objects", "board-book shapes",
      "preschool community helpers", "chibi mascots", "action-hero cartoons",
    ],
    marketing_tone: "teen_mindful_aesthetic",
    marketing_tagline: "Intricate, aesthetic coloring for teens who want the grown-up book.",
  },
};

export function resolveBandProfileForDbBand(bandKey: string | null | undefined): AgeBandProfile | null {
  return AGE_BAND_PROFILE[String(bandKey ?? "").toLowerCase()] ?? null;
}

export function bandProfileForAges(minAge: number, maxAge: number): AgeBandProfile {
  const mid = (minAge + maxAge) / 2;
  if (mid < 3) return AGE_BAND_PROFILE["2_3"];
  if (mid < 4) return AGE_BAND_PROFILE["3_5"];
  if (mid < 6) return AGE_BAND_PROFILE["4_6"];
  if (mid < 8) return AGE_BAND_PROFILE["6_8"];
  if (mid < 13) return AGE_BAND_PROFILE["8_12"];
  return AGE_BAND_PROFILE["13_17"];
}
