// Edge-function mirror of src/config/features.ts.
// Keep values in lockstep with the client config.
export const FEATURES = {
  PHASE_1_PDF_ONLY: true,
  NATIVE_STOREFRONT: true,
  SEO_AUTOMATION: false,
  BLOG_AUTOMATION: false,
  SOCIAL_POSTING: false,
  ADVANCED_BATCH_MODE: false,

  LEGACY_PIPELINE: false,

  // Premium Coloring Book Lane V2 — mirror of client flag.
  ENABLE_COLORING_LANE_V2: true,

  // AI Marketing Autopilot subsystem — mirror of client flags.
  MARKETING_AUTOPILOT: false,
  MARKETING_HONEST_PRICING: true,
  MARKETING_HONEST_REVIEWS: true,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
export const isEnabled = (flag: FeatureFlag): boolean => FEATURES[flag] === true;
