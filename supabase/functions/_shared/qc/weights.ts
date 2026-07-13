// QC v2 — category weights (total = 100).
// Single source of truth. Every scoring/reporting caller imports from here.

export const QC_RULE_VERSION = "qc-v2-2026-07";

export const QC_CATEGORIES = [
  "story_structure",
  "age_appropriateness",
  "grammar",
  "character_consistency",
  "illustration_style",
  "cover_interior_match",
  "typography_layout",
  "pdf_preflight",
  "commercial_metadata",
] as const;

export type QcCategory = (typeof QC_CATEGORIES)[number];

export const CATEGORY_WEIGHTS: Record<QcCategory, number> = {
  story_structure: 15,
  age_appropriateness: 10,
  grammar: 10,
  character_consistency: 15,
  illustration_style: 10,
  cover_interior_match: 10,
  typography_layout: 15,
  pdf_preflight: 10,
  commercial_metadata: 5,
};

// Sellable thresholds
export const CATEGORY_MIN: Partial<Record<QcCategory, number>> = {
  typography_layout: 95,
  character_consistency: 90,
  cover_interior_match: 90,
};
export const CATEGORY_FLOOR = 85; // every category must be >= this
export const OVERALL_MIN = 90;
