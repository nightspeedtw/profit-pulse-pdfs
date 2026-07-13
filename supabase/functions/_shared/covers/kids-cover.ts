// Kids-track cover style hint. Cover must match the locked visual bible
// (character reference sheet + illustration style) — no typographic hardsell.

export const KIDS_COVER_STYLE = {
  layout: "illustrated-hero-scene",
  aspect: "1600x1600", // square picture-book cover
  paletteHint: "match kids_visual_bible.color_palette exactly",
  typography: "hand-lettered / rounded storybook title, gentle drop shadow",
  photorealMockup: false, // kids covers pass through as-is
  requireBible: true,     // MUST have kids_visual_bible before generating
  negative:
    "no photorealism, no adult typography, no gradients, no corporate look, no scary imagery",
  promptSuffix:
    "Original children's picture-book cover. Hero character in a signature story moment, warm afternoon light, storybook charm. Same character model, outfit, palette, and line quality as the locked visual bible. Textless — title will be typeset separately.",
} as const;
