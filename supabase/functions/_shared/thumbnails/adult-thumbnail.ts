// Adult-track thumbnail style hint. Uses the perspective book mockup renderer
// (see _shared/book-mockup.ts and _shared/store-thumbnail.ts).

export const ADULT_THUMBNAIL_STYLE = {
  mode: "perspective-book-mockup",
  targetSize: { width: 1200, height: 1200 },
  minQcScores: {
    thumbnail_book_mockup_score: 90,
    thumbnail_readability_score: 90,
    shopify_click_appeal: 90,
    premium_product_feel: 90,
  },
} as const;
