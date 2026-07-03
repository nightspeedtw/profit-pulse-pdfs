// Central repair map. Given a failure token (reason) plus the current step,
// returns which producer function to invoke to fix it, plus after-repair step
// to resume from.
//
// Both the autopilot-pipeline (inline) and the autopilot-recovery-worker
// (out-of-band) dispatch through this table so behavior stays consistent.

import type { CanonicalStep } from "./pipeline-steps.ts";

export interface RepairAction {
  invoke: string;                  // edge function name to call
  body?: Record<string, unknown>;  // static payload to merge with { ebook_id }
  resume_from: CanonicalStep;      // step to re-enter after repair succeeds
  targeted?: boolean;              // true → only re-run the affected component
  max_attempts?: number;           // per-run cap; default 3
  note?: string;
}

export const REPAIR_MAP: Record<string, RepairAction> = {
  // --- Outline / chapters ---------------------------------------------------
  outline_missing_or_too_short: {
    invoke: "generate-outline",
    resume_from: "outline_qc",
  },
  outline_qc_needs_chapters: {
    invoke: "generate-outline",
    resume_from: "outline_qc",
  },
  no_outline: {
    invoke: "generate-outline",
    resume_from: "write_chapters",
  },
  missing_chapter: {
    invoke: "write-chapters",
    body: { mode: "fill_missing_only" },
    resume_from: "chapter_qc",
    targeted: true,
  },
  empty_or_short_chapter: {
    invoke: "write-chapters",
    body: { mode: "rewrite_short_only" },
    resume_from: "chapter_qc",
    targeted: true,
  },

  // --- Manuscript / reader QC ----------------------------------------------
  manuscript_too_short: {
    invoke: "write-chapters",
    body: { mode: "extend_to_target" },
    resume_from: "build_manuscript",
  },
  manuscript_qc_word_count: {
    invoke: "write-chapters",
    body: { mode: "extend_to_target" },
    resume_from: "manuscript_qc",
  },
  reader_qc_below_90: {
    invoke: "reader-experience-qc",
    body: { mode: "targeted_rewrite" },
    resume_from: "reader_experience_qc",
    targeted: true,
  },

  // --- Cover / thumbnail ----------------------------------------------------
  missing_cover_image: {
    invoke: "generate-cover",
    resume_from: "cover_qc",
  },
  cover_qc_below_90: {
    invoke: "generate-cover",
    body: { regenerate_strategy: true },
    resume_from: "cover_qc",
  },
  missing_thumbnail: {
    invoke: "generate-cover",
    body: { thumbnail_only: true },
    resume_from: "thumbnail_qc",
    targeted: true,
  },
  thumbnail_not_premium_mockup: {
    invoke: "generate-cover",
    body: { thumbnail_only: true, force_3d_mockup: true },
    resume_from: "thumbnail_qc",
    targeted: true,
  },

  // --- PDF ------------------------------------------------------------------
  missing_pdf_url: {
    invoke: "render-pdf",
    body: { force: true },
    resume_from: "pdf_qc",
  },
  no_pdf_screenshot_scores: {
    invoke: "render-pdf",
    body: { force: true },
    resume_from: "pdf_qc",
  },
  pdf_formatting_below_90: {
    invoke: "render-pdf",
    body: { force: true },
    resume_from: "pdf_qc",
  },
  raw_markdown_present: {
    invoke: "render-pdf",
    body: { force: true, strip_markdown: true },
    resume_from: "pdf_qc",
  },
  cover_not_full_a4: {
    invoke: "render-pdf",
    body: { force: true, full_bleed_cover: true },
    resume_from: "pdf_qc",
  },
  worksheet_wrong_category: {
    invoke: "generate-interior-visuals",
    body: { mode: "regenerate_worksheets_by_category" },
    resume_from: "pdf_rendering",
    targeted: true,
  },
  worksheet_overflow: {
    invoke: "render-pdf",
    body: { force: true, wrap_wide_tables: true },
    resume_from: "pdf_qc",
  },

  // --- Product copy / pricing ----------------------------------------------
  missing_product_copy: {
    invoke: "generate-shopify-package",
    body: { mode: "copy_only" },
    resume_from: "product_page_qc",
    targeted: true,
  },
  missing_price: {
    invoke: "compute-pricing",
    resume_from: "product_page_qc",
    targeted: true,
  },
  product_page_incomplete: {
    invoke: "generate-shopify-package",
    resume_from: "product_page_qc",
  },

  // --- Shopify --------------------------------------------------------------
  no_shopify_product_id: {
    invoke: "shopify-draft-upload",
    resume_from: "shopify_verification",
  },
  no_shopify_draft_url: {
    invoke: "shopify-draft-upload",
    body: { verify_only: true },
    resume_from: "shopify_verification",
  },
  no_final_report: {
    invoke: "autopilot-pipeline",
    body: { action: "write_final_report" },
    resume_from: "final_report",
  },
};

export function lookupRepair(reason: string | null | undefined): RepairAction | null {
  if (!reason) return null;
  return REPAIR_MAP[reason] ?? null;
}
