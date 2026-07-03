// Central feature flags for the Ebook Factory.
//
// Phase 1 is PDF-only: One-Click → Generate → QC → Auto-Fix → Final Premium PDF.
// Everything downstream (Shopify upload, SEO, blog, social) is disabled by
// default and must be re-enabled here — never by an env var — so a missing
// third-party token can never block PDF generation.
export const FEATURES = {
  PHASE_1_PDF_ONLY: true,
  SHOPIFY_UPLOAD: false,
  SEO_AUTOMATION: false,
  BLOG_AUTOMATION: false,
  SOCIAL_POSTING: false,
  ADVANCED_BATCH_MODE: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;

export const isEnabled = (flag: FeatureFlag): boolean => FEATURES[flag] === true;
