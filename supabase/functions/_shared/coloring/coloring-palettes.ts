// Warm kid-friendly palettes per coloring category, used by the
// deterministic self-art cover rung ('cover_can_never_fail' skill).
//
// Each palette is [background_tint, ...subject_cycle]. Background gets the
// LARGEST detected flood-fill region; subject regions cycle through the
// remaining colors in size-descending order. All colors are chosen to
// stay legible under the SVG title-treatment overlay (colors.stroke =
// dark ink), so hue rotation and lightness are constrained.
//
// Palettes are DETERMINISTIC — the same category always produces the
// same cover feel, run to run.

export interface ColoringPalette {
  /** 0xRRGGBB integer, background wash for the composed cover. */
  background: number;
  /** Cycle used for subject fills, largest-first. */
  subjects: number[];
}

const P = (bg: number, ...subjects: number[]): ColoringPalette => ({ background: bg, subjects });

export const COLORING_CATEGORY_PALETTES: Record<string, ColoringPalette> = {
  bold_and_easy:           P(0xFFF3D6, 0xF6A96B, 0xF5CC5D, 0x6BAA75, 0x4FA3D8, 0xE7789A),
  cottagecore_home_life:   P(0xFBEEDC, 0xE3B778, 0xBFD8A7, 0xD68E6E, 0xE4C1D9, 0xA6C4E0),
  cozy_coloring:           P(0xFDEBD4, 0xE7A97F, 0xC7B394, 0xA8C4A2, 0xE6C9DC, 0xEEC466),
  cute_animals:            P(0xFFECD6, 0xF6B58A, 0xF5D46F, 0xB5D5A0, 0xF1A6BA, 0xB7C8EB),
  dinosaurs:               P(0xF6E7C1, 0xA4C48B, 0xE6A56C, 0xE4C464, 0xC79ED0, 0x84B7C9),
  educational_abc_numbers: P(0xFFF6D6, 0xF4A340, 0x6EB1E0, 0xE86A7C, 0x74C288, 0xE9C846),
  farm_and_woodland:       P(0xF7EAC6, 0xC8A472, 0xE9A66B, 0xA8C58A, 0xE4C4A0, 0xEBC85C),
  floral_botanical:        P(0xFFEEE1, 0xF3A6B3, 0xE8C664, 0x9CBF88, 0xC6A6D9, 0xEB9F80),
  gothic_witchy_spooky:    P(0xE5D9EA, 0xB89ACB, 0xEEC46B, 0xE18E7E, 0x8CA9C7, 0xC7B589),
  kawaii_food_cafe:        P(0xFFE7D6, 0xF6A48A, 0xF6D06B, 0xB6D0A0, 0xE8B0CE, 0xB7C7EA),
  mandala_geometric:       P(0xFFEED6, 0xE7A76B, 0xE9C660, 0x82B8C0, 0xB89ACB, 0xE2758C),
  mermaid_ocean_fantasy:   P(0xD9EEF3, 0x8FCDD8, 0xE7C05E, 0xE29AAF, 0xB7C7EA, 0x8DC29E),
  pets_cats_dogs:          P(0xFFECD1, 0xE9A776, 0xEDC968, 0xB6D0A0, 0xE7A5B7, 0xB7C7EA),
  preschool_toddler:       P(0xFFF1D6, 0xF6A96B, 0xEED462, 0x6EB1E0, 0xE86A7C, 0x74C288),
  princess_fairy_magic:    P(0xFCE3EE, 0xE8A6C4, 0xEEC46B, 0xB29DD3, 0x9EC8E5, 0xE59F80),
  sea_animals:             P(0xD3E8F0, 0x82BCD0, 0xE7C05E, 0xE29AAF, 0xB7C7EA, 0x8DC29E),
  seasonal_holidays:       P(0xFFE9D6, 0xE18077, 0xEBC85C, 0x82B58F, 0xB7C7EA, 0xC7A0CC),
  unicorn_fantasy:         P(0xFDE7F1, 0xE8A6C4, 0xEEC46B, 0xB29DD3, 0x9EC8E5, 0xE59F80),
  vehicles_construction:   P(0xF7E6BE, 0xE9A76B, 0xEDC85C, 0x74A6DA, 0xE07979, 0x76B58A),
  wild_safari_animals:     P(0xF7E4B6, 0xC58F5A, 0xE6A26B, 0xA6BF75, 0xE9C85C, 0xB79070),
};

export const COLORING_DEFAULT_PALETTE: ColoringPalette = P(
  0xFFF1D6, // warm cream
  0xF6A96B, // warm orange
  0xEED462, // yellow
  0x6EB1E0, // sky blue
  0xE86A7C, // pink coral
  0x74C288, // grass green
);

export function paletteForCategory(categoryKey: string | null | undefined): ColoringPalette {
  const key = (categoryKey ?? "").toLowerCase().trim();
  return COLORING_CATEGORY_PALETTES[key] ?? COLORING_DEFAULT_PALETTE;
}

/** Convert 0xRRGGBB → 0xRRGGBBAA for ImageScript.setPixelAt. */
export function rgb24ToRgba32(rgb: number, alpha = 0xFF): number {
  return (((rgb & 0xFFFFFF) << 8) | (alpha & 0xFF)) >>> 0;
}
