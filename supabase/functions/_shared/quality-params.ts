// Owner doctrine "quality_at_the_source" (2026-07-19).
//
// First-shot quality regime per call-class. The cheap-first-then-upgrade
// pattern is BACKWARDS — a $0.003-0.006 first shot at proper params beats
// three retries at low quality. These constants are the SINGLE source of
// truth read by every image call site.

export type CallClass =
  | "coloring_interior"
  | "coloring_cover"
  | "kids_interior"
  | "kids_cover";

export interface QualityParams {
  num_inference_steps: number;
  image_size: "square_hd" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  crisp_clauses: string[];
}

const CRISP_LINE_CLAUSES = [
  "crisp, thick, uniform black outlines on pure white background",
  "no shading, no gray fills, no gradients — pure line art",
  "printer-friendly resolution, high contrast, no anti-alias artifacts",
];

const CRISP_ART_CLAUSES = [
  "painterly children's book illustration, warm colors, cozy lighting",
  "no six-finger hands, no melted faces, no photo-realistic AI blobs",
  "consistent character across every page (locked style)",
];

export const QUALITY_PARAMS: Record<CallClass, QualityParams> = {
  coloring_interior: {
    num_inference_steps: 8,
    image_size: "square_hd",
    crisp_clauses: CRISP_LINE_CLAUSES,
  },
  coloring_cover: {
    num_inference_steps: 8,
    image_size: "square_hd",
    crisp_clauses: CRISP_LINE_CLAUSES,
  },
  kids_interior: {
    num_inference_steps: 8,
    image_size: "square_hd",
    crisp_clauses: CRISP_ART_CLAUSES,
  },
  kids_cover: {
    num_inference_steps: 8,
    image_size: "square_hd",
    crisp_clauses: CRISP_ART_CLAUSES,
  },
};

export function qualityParamsFor(cls: CallClass): QualityParams {
  return QUALITY_PARAMS[cls];
}
