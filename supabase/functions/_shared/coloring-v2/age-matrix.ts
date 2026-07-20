// Coloring V2 age-to-art matrix. Governs line weight, complexity, region
// count, and allowed/forbidden motifs per age band.
// @ts-nocheck

export type V2AgeBand = "2-4" | "4-6" | "6-8" | "8-12" | "13-17" | "all-ages";

export interface AgeProfile {
  band: V2AgeBand;
  label: string;
  lineWeightPx: [number, number];    // stroke thickness range (in a 1088px canvas)
  regions: [number, number];         // enclosed regions per page
  focalCount: [number, number];      // number of primary subjects
  complexity: "chunky" | "simple" | "medium" | "detailed" | "intricate" | "balanced";
  positive: string[];
  negative: string[];
  coverStyleHint: string;
}

export const AGE_MATRIX: Record<V2AgeBand, AgeProfile> = {
  "2-4": {
    band: "2-4", label: "Ages 2-4",
    lineWeightPx: [10, 14], regions: [4, 8], focalCount: [1, 2],
    complexity: "chunky",
    positive: [
      "extra-thick clean outlines",
      "large simple shapes",
      "wide-open enclosed regions perfect for chubby toddler hands",
      "friendly rounded faces",
    ],
    negative: ["fine detail", "cross-hatching", "tiny patterns", "narrow gaps", "text inside art"],
    coverStyleHint: "bold chunky lines, cheerful primary-color palette",
  },
  "4-6": {
    band: "4-6", label: "Ages 4-6",
    lineWeightPx: [7, 10], regions: [8, 16], focalCount: [1, 3],
    complexity: "simple",
    positive: [
      "bold clean outlines",
      "medium simple shapes",
      "clear enclosed regions kids can fill without frustration",
    ],
    negative: ["tiny cross-hatching", "photo-realistic textures", "dense micro-detail"],
    coverStyleHint: "clean bold lines, playful cheerful palette",
  },
  "6-8": {
    band: "6-8", label: "Ages 6-8",
    lineWeightPx: [5, 8], regions: [15, 28], focalCount: [1, 4],
    complexity: "medium",
    positive: [
      "clean outlines with light interior detail",
      "moderate patterns (dots, small stars, gentle textures)",
      "clear enclosed regions",
    ],
    negative: ["overwhelming density", "cross-hatching", "shading gradients"],
    coverStyleHint: "detailed but readable line work, energetic palette",
  },
  "8-12": {
    band: "8-12", label: "Ages 8-12",
    lineWeightPx: [3, 6], regions: [25, 55], focalCount: [1, 5],
    complexity: "detailed",
    positive: [
      "detailed line work",
      "layered patterns, decorative motifs, thematic textures",
      "confident enclosed regions",
    ],
    negative: ["photo-realistic shading", "gray fills", "solid black interiors"],
    coverStyleHint: "detailed illustrative style, rich thematic palette",
  },
  "13-17": {
    band: "13-17", label: "Ages 13-17",
    lineWeightPx: [2, 5], regions: [40, 120], focalCount: [1, 3],
    complexity: "intricate",
    positive: [
      "intricate mandala-quality line work",
      "dense decorative patterns, geometric tessellations, botanical motifs",
      "adult-teen aesthetic sensibility",
      "symmetry where appropriate",
    ],
    negative: ["childish rounded cartoon style", "chunky lines", "kiddie palette", "solid black fills"],
    coverStyleHint: "sophisticated intricate line art, moody / mystical palette",
  },
  "all-ages": {
    band: "all-ages", label: "All Ages",
    lineWeightPx: [4, 7], regions: [18, 40], focalCount: [1, 4],
    complexity: "balanced",
    positive: [
      "balanced line weight neither too chunky nor too fine",
      "moderate detail that both kids and adults enjoy",
    ],
    negative: ["extreme minimalism", "extreme density"],
    coverStyleHint: "versatile clean-detailed line art, universal palette",
  },
};

export function getAgeProfile(band: string): AgeProfile {
  const p = AGE_MATRIX[band as V2AgeBand];
  if (!p) throw new Error(`coloring_v2: unsupported age band "${band}"`);
  return p;
}
