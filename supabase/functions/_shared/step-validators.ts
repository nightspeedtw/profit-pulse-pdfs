// Per-step output validators. Given the ebook row (and optionally its
// chapters), each validator answers: is the artifact this step is supposed to
// produce actually present and usable? The pipeline treats a step as `passed`
// ONLY if the matching validator returns { valid: true }.

import type { CanonicalStep } from "./pipeline-steps.ts";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface EbookLike {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  hook?: string | null;
  outline_json?: any;
  manuscript_word_count?: number | null;
  cover_url?: string | null;
  cover_pdf_url?: string | null;
  thumbnail_url?: string | null;
  thumbnail_book_mockup_score?: number | null;
  pdf_url?: string | null;
  pdf_qc?: any;
  reader_qc?: any;
  storefront_product_id?: string | null;
  storefront_draft_url?: string | null;
  product_title?: string | null;
  product_description?: string | null;
  price?: number | null;
  canonical_status?: string | null;
  final_report_json?: any;
}

const ok = (): ValidationResult => ({ valid: true });
const bad = (reason: string): ValidationResult => ({ valid: false, reason });

export function validateStep(
  step: CanonicalStep,
  eb: EbookLike,
  extras: { chapters?: Array<{ content?: string | null; word_count?: number | null }> } = {},
): ValidationResult {
  const chapters = extras.chapters ?? [];

  switch (step) {
    case "start_run":
      return ok();

    case "preflight_check":
      return ok(); // Validation is inline in the preflight function.

    case "generate_topic":
    case "title_generation":
      return eb.title && eb.title.trim().length > 5 ? ok() : bad("missing_title");

    case "title_qc":
      return eb.title && eb.title.length > 5 ? ok() : bad("title_qc_missing_title");

    case "generate_outline": {
      const arr = eb.outline_json?.chapters;
      if (!Array.isArray(arr) || arr.length < 8) return bad("outline_missing_or_too_short");
      return ok();
    }

    case "outline_qc": {
      const arr = eb.outline_json?.chapters;
      if (!Array.isArray(arr) || arr.length < 8) return bad("outline_qc_needs_chapters");
      return ok();
    }

    case "write_chapters":
    case "chapter_qc": {
      const expected = eb.outline_json?.chapters?.length ?? 0;
      if (!expected) return bad("no_outline");
      if (chapters.length < expected) return bad("missing_chapter");
      if (chapters.some((c) => !c.content || (c.content?.length ?? 0) < 500))
        return bad("empty_or_short_chapter");
      return ok();
    }

    case "build_manuscript":
      return (eb.manuscript_word_count ?? 0) >= 12000 ? ok() : bad("manuscript_too_short");

    case "reader_experience_qc":
      return (eb.reader_qc?.overall_score ?? 0) >= 90 ? ok() : bad("reader_qc_below_90");

    case "manuscript_qc":
      return (eb.manuscript_word_count ?? 0) >= 12000 ? ok() : bad("manuscript_qc_word_count");

    case "cover_strategy":
      return ok(); // strategy is inline metadata; no separate artifact yet

    case "cover_generation":
      return eb.cover_url ? ok() : bad("missing_cover_image");

    case "cover_qc": {
      const score = eb.pdf_qc?.cover_pdf_score ?? eb.pdf_qc?.cover_full_a4 ?? 0;
      return score >= 90 || eb.cover_pdf_url ? ok() : bad("cover_qc_below_90");
    }

    case "thumbnail_generation":
      return eb.thumbnail_url ? ok() : bad("missing_thumbnail");

    case "thumbnail_qc":
      return (eb.thumbnail_book_mockup_score ?? 0) >= 90
        ? ok()
        : bad("thumbnail_not_premium_mockup");

    case "pdf_layout_generation":
      return ok();

    case "pdf_rendering":
      return eb.pdf_url ? ok() : bad("missing_pdf_url");

    case "pdf_screenshot_qc":
      return eb.pdf_qc && Object.keys(eb.pdf_qc).length > 0
        ? ok()
        : bad("no_pdf_screenshot_scores");

    case "pdf_qc": {
      const q = eb.pdf_qc ?? {};
      const formatting = q.formatting_score ?? 0;
      const rawMd = q.raw_markdown_score ?? 100;
      const a4 = q.cover_full_a4_score ?? q.cover_pdf_score ?? 100;
      if (formatting < 90) return bad("pdf_formatting_below_90");
      if (rawMd < 100) return bad("raw_markdown_present");
      if (a4 < 100) return bad("cover_not_full_a4");
      return ok();
    }

    case "product_copy_generation":
      return eb.product_title && eb.product_description ? ok() : bad("missing_product_copy");

    case "pricing_generation":
      return (eb.price ?? 0) > 0 ? ok() : bad("missing_price");

    case "product_page_qc":
      return eb.product_title && eb.product_description && (eb.price ?? 0) > 0
        ? ok()
        : bad("product_page_incomplete");

    case "storefront_draft_upload":
      return eb.storefront_product_id ? ok() : bad("no_storefront_product_id");

    case "storefront_verification":
      return eb.storefront_draft_url ? ok() : bad("no_storefront_draft_url");

    case "final_report":
      return eb.final_report_json && Object.keys(eb.final_report_json).length > 0
        ? ok()
        : bad("no_final_report");
  }
}
