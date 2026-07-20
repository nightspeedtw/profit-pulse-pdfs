// matter-pages-style.ts — PURE style/palette resolver for matter pages.
// No pdf-lib import so this can be imported by regression tests.
// The pdf-lib drawing functions live in matter-pages.ts alongside this.

export interface MatterPalette {
  paper: [number, number, number];
  primary: [number, number, number];
  ink: [number, number, number];
  accent: [number, number, number];
  swatch: Array<[number, number, number]>;
}

export interface MatterStyle {
  band: "toddler" | "preschool" | "early_reader" | "middle_grade" | "teen";
  ageMin: number;
  ageMax: number;
  titlePt: number;
  headingPt: number;
  bodyPt: number;
  tinyPt: number;
  minPt: number;
  palette: MatterPalette;
  cornerVignetteFrac: number;
  lineHeightFactor: number;
}

export const PALETTES: Record<MatterStyle["band"], MatterPalette> = {
  toddler: {
    paper: [1.0, 0.973, 0.918],
    primary: [0.95, 0.55, 0.30],
    ink: [0.24, 0.14, 0.08],
    accent: [0.98, 0.78, 0.35],
    swatch: [[0.96, 0.45, 0.42], [0.98, 0.78, 0.35], [0.55, 0.80, 0.55], [0.42, 0.68, 0.90], [0.75, 0.55, 0.85]],
  },
  preschool: {
    paper: [1.0, 0.965, 0.895],
    primary: [0.93, 0.48, 0.22],
    ink: [0.22, 0.14, 0.08],
    accent: [0.35, 0.68, 0.72],
    swatch: [[0.94, 0.42, 0.45], [0.98, 0.75, 0.32], [0.42, 0.75, 0.55], [0.32, 0.62, 0.88], [0.72, 0.45, 0.82]],
  },
  early_reader: {
    paper: [0.996, 0.973, 0.910],
    primary: [0.60, 0.35, 0.15],
    ink: [0.18, 0.12, 0.06],
    accent: [0.30, 0.55, 0.72],
    swatch: [[0.88, 0.38, 0.42], [0.94, 0.68, 0.28], [0.38, 0.68, 0.48], [0.28, 0.58, 0.84], [0.62, 0.40, 0.75]],
  },
  middle_grade: {
    paper: [0.98, 0.97, 0.94],
    primary: [0.30, 0.35, 0.55],
    ink: [0.14, 0.14, 0.18],
    accent: [0.85, 0.55, 0.28],
    swatch: [[0.82, 0.32, 0.40], [0.90, 0.62, 0.24], [0.32, 0.62, 0.42], [0.22, 0.48, 0.78], [0.55, 0.32, 0.68]],
  },
  teen: {
    paper: [0.965, 0.970, 0.980],
    primary: [0.20, 0.24, 0.34],
    ink: [0.10, 0.12, 0.16],
    accent: [0.20, 0.72, 0.68],
    swatch: [[0.22, 0.72, 0.68], [0.85, 0.32, 0.55], [0.95, 0.60, 0.20], [0.42, 0.42, 0.85], [0.20, 0.24, 0.34]],
  },
};

export function resolveMatterStyle(ageMin: number, ageMax: number): MatterStyle {
  const min = Math.max(0, Math.min(18, ageMin | 0));
  const max = Math.max(min, Math.min(18, ageMax | 0));
  const mid = (min + max) / 2;
  let band: MatterStyle["band"];
  if (mid <= 3.5) band = "toddler";
  else if (mid <= 6.5) band = "preschool";
  else if (mid <= 9.5) band = "early_reader";
  else if (mid <= 12.5) band = "middle_grade";
  else band = "teen";

  const sizes = {
    toddler:      { titlePt: 44, headingPt: 26, bodyPt: 17, tinyPt: 12, minPt: 11, lineHeightFactor: 1.7,  cornerVignetteFrac: 0.18 },
    preschool:    { titlePt: 40, headingPt: 24, bodyPt: 15, tinyPt: 11, minPt: 10, lineHeightFactor: 1.6,  cornerVignetteFrac: 0.17 },
    early_reader: { titlePt: 36, headingPt: 22, bodyPt: 13, tinyPt: 10, minPt: 9,  lineHeightFactor: 1.55, cornerVignetteFrac: 0.16 },
    middle_grade: { titlePt: 32, headingPt: 20, bodyPt: 12, tinyPt: 9,  minPt: 8,  lineHeightFactor: 1.5,  cornerVignetteFrac: 0.15 },
    teen:         { titlePt: 30, headingPt: 18, bodyPt: 11, tinyPt: 9,  minPt: 8,  lineHeightFactor: 1.45, cornerVignetteFrac: 0.14 },
  } as const;

  return { band, ageMin: min, ageMax: max, palette: PALETTES[band], ...sizes[band] };
}

export function defaultCopyrightText(): string {
  const year = new Date().getFullYear();
  return [
    `© ${year} secretpdf.co. All rights reserved.`,
    "",
    "This coloring book is licensed for personal, non-commercial use.",
    "Individual coloring pages may be copied for personal or classroom use.",
    "Not for resale, redistribution, or commercial reproduction.",
    "",
    "Visit secretpdf.co for more coloring books and kids' printables.",
  ].join("\n");
}

export const MATTER_PAGES_DESIGN_VERSION = "matter_pages_design_v2";
