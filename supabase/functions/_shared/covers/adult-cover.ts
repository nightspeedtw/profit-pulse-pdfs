// Adult-track cover style hint. Kept as a thin module so cover generators can
// pick a template by track without knowing template internals.

export const ADULT_COVER_STYLE = {
  layout: "typographic-hardsell",
  aspect: "1400x2100", // Amazon/KDP portrait
  paletteHint: "premium dark or bold gradient with high-contrast title block",
  typography: "bold sans-serif hero title, small tag line, thin author line",
  photorealMockup: true, // book-mockup.ts perspective render for thumbnail
  negative: "no cartoons, no children's illustration, no scribbles",
  promptSuffix:
    "Premium non-fiction $24 PDF cover. Textless background — title will be typeset over it. Clean, engineered, high-conversion look.",
} as const;
