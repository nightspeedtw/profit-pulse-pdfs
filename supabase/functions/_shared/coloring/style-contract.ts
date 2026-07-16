// Locked line-art style contract for a coloring book. Once calibration
// passes, the contract is frozen on ebooks_kids.metadata.coloring_style_contract
// and every interior page prompt is composed from it deterministically.

import { TEXTLESS_DIRECTIVE, withTextlessDirective } from "../textless-illustration-policy.ts";
import type { ColoringCategory } from "./category.ts";
import { speciesAnatomyPromptClause } from "./species-anatomy.ts";

export interface LineArtStyleContract {
  style_family: string;                     // e.g. "clean_friendly_thick_line"
  line_thickness: "thin" | "medium" | "thick" | "extra_thick";
  eye_style: string;                        // "simple round with dot pupils"
  realism_level: "cartoon" | "stylized" | "semi-realistic";
  proportion_family: string;                // "rounded_child_friendly"
  curve_softness: "soft" | "medium" | "sharp";
  background_complexity: "none" | "low" | "medium";
  detail_density: "low" | "medium";
  border_treatment: "none" | "safe_margin";
  subject_scale_pct: [number, number];      // e.g. [60, 80]
  white_space_balance: "generous" | "balanced";
  style_prompt_snippet: string;             // the frozen phrase injected into every prompt
}

export const DEFAULT_KIDS_4_6_STYLE: LineArtStyleContract = {
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
    "Clean friendly children's coloring-book line art, thick smooth black contour lines, " +
    "rounded forms, large closed coloring spaces, minimal interior shading, " +
    "simple expressive faces, pure white background",
};

export interface PagePlanEntry {
  canonical_page_number: number;
  primary_subject: string;
  secondary_subjects: string[];
  scene: string;
  complexity: "simple" | "medium" | "complex";
  required_elements: string[];
  forbidden_elements: string[];
  composition_type: string;
  scene_bucket?: string; // one of SCENE_TAXONOMY
}

const NEGATIVE_CLAUSES = [
  "NO grayscale",
  "NO shadows",
  "NO cross-hatching",
  "NO color fills",
  "NO large solid-black areas or filled black shapes (outlines only; every enclosed region must be white so a child can color it)",
  "NO text, letters, numbers, watermarks, signatures, logos",
  "NO border clipping",
  "NO cropped subject",
  "NO out-of-category objects",
  "NO anatomically incorrect subjects (correct number of limbs, fingers/paws, eyes, ears, wings, tails, horns for the subject; no fused, missing, extra, or malformed features; no incoherent faces)",
  "NO imitation of any living artist's signature style",
  "NO recognizable copyrighted or trademarked characters, mascots, or brand IP",
];

export interface BuildInteriorPromptOptions {
  /**
   * Optional prevention-rule clause emitted by the First-Pass-Yield learner.
   * Concatenated ahead of the negative clauses so every past-failure counter
   * is present in the base prompt for this species/scene.
   */
  learned_prevention_clause?: string;
}

export function buildInteriorPrompt(
  page: PagePlanEntry,
  contract: LineArtStyleContract,
  category: Pick<ColoringCategory, "category_name" | "target_age_min" | "target_age_max">,
  opts: BuildInteriorPromptOptions = {},
): string {
  const [minScale, maxScale] = contract.subject_scale_pct;
  const anatomyClause = speciesAnatomyPromptClause(page.primary_subject);
  // Owner law (2026-07-16, cover audit fallout): the age-band's declared
  // line thickness is authoritative. Older thin-line renders shipped for a
  // "thick" band because the directive was buried inside a mid-prompt
  // sentence. Emit an UPPERCASE, first-position mandate the model cannot
  // miss, tied to the band's numeric hint.
  const thicknessPx = contract.line_thickness === "extra_thick" ? "8-12"
    : contract.line_thickness === "thick" ? "6-9"
    : contract.line_thickness === "medium" ? "4-6"
    : "2-4";
  const thicknessMandate = `LINE THICKNESS: ${contract.line_thickness.toUpperCase()} (~${thicknessPx}px equivalent). ` +
    `EVERY contour is a uniform ${contract.line_thickness} pure-black stroke. ` +
    `DO NOT ship thin, hairline, or sketch-weight lines — that violates the age-band contract.`;
  const parts = [
    thicknessMandate,
    `Printable children's coloring-book page.`,
    `Category: ${category.category_name}. Primary subject: ${page.primary_subject}.`,
    page.secondary_subjects.length
      ? `Supporting elements: ${page.secondary_subjects.join(", ")}.`
      : "",
    `Scene: ${page.scene}.`,
    `Age band: ${category.target_age_min}-${category.target_age_max}.`,
    contract.style_prompt_snippet + ".",
    `Line thickness: ${contract.line_thickness}. Curves: ${contract.curve_softness}.`,
    `Background complexity: ${contract.background_complexity}. Detail density: ${contract.detail_density}.`,
    `Subject fills ${minScale}-${maxScale}% of usable area. Centered, balanced composition. Safe margin preserved.`,
    `Pure black outlines on pure white. Printable 8.5x11 portrait.`,
    anatomyClause,
    opts.learned_prevention_clause ?? "",
    NEGATIVE_CLAUSES.join(". ") + ".",
  ].filter(Boolean);
  return withTextlessDirective(parts.join(" "));
}

/** Guarantees the prompt includes the canonical textless directive. */
export function assertPromptCompliant(prompt: string): void {
  if (!prompt.includes(TEXTLESS_DIRECTIVE)) {
    throw new Error("coloring interior prompt missing TEXTLESS_DIRECTIVE");
  }
  if (!/pure white background/i.test(prompt)) {
    throw new Error("coloring interior prompt missing pure-white-background lock");
  }
}
