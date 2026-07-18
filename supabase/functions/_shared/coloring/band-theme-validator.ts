// band-theme-validator.ts
// -----------------------------------------------------------------------------
// Owner directive (2026-07-20 queue-hygiene): coverage-gate the category ↔
// age-band pairing at CONCEPT-CREATION time. Before this gate existed the
// autopilot happily stamped "Baby Vehicles & Construction (Ages 13-17)" —
// a toddler theme wearing a teen band. Those books are permanently off-brand
// and cannot be silently re-banded (the theme was picked for the wrong reader);
// they must be retired and a fresh, band-matched concept generated instead.
//
// The gate is applied in two places:
//   1. coloring-autopilot-tick — filters the category weight-pick to only
//      categories legal for the target band.
//   2. coloring-book-start — hard-rejects any explicit dispatch whose
//      (category_key, db_band) pair is not on the matrix (422).
//
// This file is the single source of truth for that matrix.

import { AGE_BAND_PROFILE } from "./age-bands.ts";

/**
 * Per-band ALLOWED category matrix. A category is legal for a band iff it
 * appears in that band's set. Categories NOT in the set are `band_theme_mismatch`.
 *
 * Derived from AGE_BAND_PROFILE theme_hints + forbidden_themes semantics
 * (owner spec 2026-07-20). Kept as an explicit matrix — do NOT compute it
 * heuristically from theme_hints strings; a mismatch must be a stable,
 * reviewable data decision.
 */
export const CATEGORY_ALLOWED_FOR_BAND: Record<string, ReadonlySet<string>> = {
  "2_3": new Set([
    "cute_animals",
    "farm_and_woodland",
    "pets_cats_dogs",
    "vehicles_construction",
    "preschool_toddler",
    "educational_abc_numbers",
    "seasonal_holidays",
    "sea_animals",
  ]),
  "3_5": new Set([
    "cute_animals",
    "farm_and_woodland",
    "pets_cats_dogs",
    "vehicles_construction",
    "preschool_toddler",
    "educational_abc_numbers",
    "seasonal_holidays",
    "sea_animals",
    "dinosaurs",
    "princess_fairy_magic",
    "unicorn_fantasy",
  ]),
  "4_6": new Set([
    "cute_animals",
    "farm_and_woodland",
    "pets_cats_dogs",
    "vehicles_construction",
    "preschool_toddler",
    "educational_abc_numbers",
    "seasonal_holidays",
    "sea_animals",
    "dinosaurs",
    "princess_fairy_magic",
    "unicorn_fantasy",
    "mermaid_ocean_fantasy",
    "wild_safari_animals",
  ]),
  "6_8": new Set([
    "cute_animals",
    "farm_and_woodland",
    "pets_cats_dogs",
    "vehicles_construction",
    "seasonal_holidays",
    "sea_animals",
    "dinosaurs",
    "princess_fairy_magic",
    "unicorn_fantasy",
    "mermaid_ocean_fantasy",
    "wild_safari_animals",
  ]),
  "8_12": new Set([
    "kawaii_food_cafe",
    "mandala_geometric",
    "cottagecore_home_life",
    "gothic_witchy_spooky",
    "mermaid_ocean_fantasy",
    "unicorn_fantasy",
    "floral_botanical",
    "wild_safari_animals",
    "sea_animals",
    "dinosaurs",
    "cozy_coloring",
  ]),
  "13_17": new Set([
    "cottagecore_home_life",
    "gothic_witchy_spooky",
    "mandala_geometric",
    "floral_botanical",
    "cozy_coloring",
    "bold_and_easy",
    "kawaii_food_cafe",
  ]),
};

/**
 * Normalize any age-band spelling seen on ebooks_kids rows / API bodies to
 * the DB canonical form used by AGE_BAND_PROFILE and the matrix above.
 *   "4-6"   → "4_6"
 *   "4–6"   → "4_6"   (en-dash)
 *   "13-17" → "13_17"
 *   "2-4"   → "2_3"   (library key → DB band alias)
 *   "3-5"   → "3_5"
 *   "6-8"   → "6_8"
 *   "8-12"  → "8_12"
 *   "teen_adult" / "all_ages" → null (no matrix entry, do not gate)
 */
export function normalizeBandKey(raw: string | null | undefined): string | null {
  const k = String(raw ?? "").trim().toLowerCase().replace(/[–—]/g, "-");
  if (!k) return null;
  if (k in AGE_BAND_PROFILE) return k;
  const map: Record<string, string> = {
    "2-3": "2_3",
    "2-4": "2_3",
    "3-5": "3_5",
    "4-6": "4_6",
    "6-8": "6_8",
    "8-12": "8_12",
    "13-17": "13_17",
  };
  return map[k] ?? null;
}

export interface BandThemeValidation {
  ok: boolean;
  db_band: string | null;
  category_key: string;
  reason?: "band_theme_mismatch" | "unknown_band" | "unknown_category";
  message?: string;
  allowed_categories?: string[];
}

/**
 * Validate a (category_key, band) pairing. Returns `ok:true` when the pair is
 * on the matrix. Returns `ok:false` with a stable `reason` code otherwise —
 * do NOT re-band silently; callers must retire and regenerate a fresh concept.
 *
 * Bands with no matrix entry (e.g. "all_ages") are treated as ungated and
 * return ok:true so multi-band bundles are not blocked here.
 */
export function validateCategoryForBand(
  categoryKey: string,
  bandRaw: string | null | undefined,
): BandThemeValidation {
  const db_band = normalizeBandKey(bandRaw);
  const cat = String(categoryKey ?? "").toLowerCase();
  if (!cat) {
    return { ok: false, db_band, category_key: cat, reason: "unknown_category", message: "category_key empty" };
  }
  if (!db_band) {
    // No matrix entry for this band → not our gate to enforce.
    return { ok: true, db_band, category_key: cat };
  }
  const allowed = CATEGORY_ALLOWED_FOR_BAND[db_band];
  if (!allowed) {
    return { ok: true, db_band, category_key: cat };
  }
  if (allowed.has(cat)) {
    return { ok: true, db_band, category_key: cat };
  }
  return {
    ok: false,
    db_band,
    category_key: cat,
    reason: "band_theme_mismatch",
    message: `Category '${cat}' is not on the allowed matrix for band '${db_band}'.`,
    allowed_categories: [...allowed].sort(),
  };
}

/**
 * Filter a list of {category_key,...} objects to only those allowed for a
 * given band. Used by the autopilot tick before weighted picking.
 */
export function filterCategoriesForBand<T extends { category_key: string }>(
  categories: T[],
  bandRaw: string | null | undefined,
): T[] {
  const db_band = normalizeBandKey(bandRaw);
  if (!db_band) return categories;
  const allowed = CATEGORY_ALLOWED_FOR_BAND[db_band];
  if (!allowed) return categories;
  return categories.filter((c) => allowed.has(String(c.category_key).toLowerCase()));
}
