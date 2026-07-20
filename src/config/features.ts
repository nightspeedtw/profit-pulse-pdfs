// Central feature flags for the Ebook Factory.
//
// Phase 1 is PDF-only: One-Click → Generate → QC → Auto-Fix → Final Premium PDF.
// Everything downstream (SEO, blog, social) is disabled by
// default and must be re-enabled here — never by an env var — so a missing
// third-party token can never block PDF generation.
export const FEATURES = {
  PHASE_1_PDF_ONLY: true,
  NATIVE_STOREFRONT: true,
  SEO_AUTOMATION: false,
  BLOG_AUTOMATION: false,
  SOCIAL_POSTING: false,
  ADVANCED_BATCH_MODE: false,

  // Legacy pre-Phase-1 pipeline (autopilot-orchestrator, build-pdf,
  // worksheet-preview, generate-interior-visuals, idea-copywriter).
  // Off = Phase 1 uses render-pdf + premium-title-expert. Flip to true
  // to reactivate the legacy path without redeploying.
  LEGACY_PIPELINE: false,

  // Premium Coloring Book Lane V2 — isolated experimental pipeline.
  // OFF by default. Flip to true to expose /admin/coloring-lab-v2 and
  // /coloring-preview-v2/:bookId. Does not affect the existing coloring
  // lane in any way when off OR on (V2 uses its own tables, functions,
  // storage bucket, status columns, and cron/lock names).
  ENABLE_COLORING_LANE_V2: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;

export const isEnabled = (flag: FeatureFlag): boolean => FEATURES[flag] === true;
