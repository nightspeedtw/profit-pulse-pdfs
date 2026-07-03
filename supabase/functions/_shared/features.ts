// Edge-function mirror of src/config/features.ts.
// Keep values in lockstep with the client config.
export const FEATURES = {
  PHASE_1_PDF_ONLY: true,
  SHOPIFY_UPLOAD: true,
  SEO_AUTOMATION: false,
  BLOG_AUTOMATION: false,
  SOCIAL_POSTING: false,
  ADVANCED_BATCH_MODE: false,
  LEGACY_PIPELINE: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
export const isEnabled = (flag: FeatureFlag): boolean => FEATURES[flag] === true;
