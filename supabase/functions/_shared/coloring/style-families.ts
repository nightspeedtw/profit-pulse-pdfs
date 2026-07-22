// Style families for coloring-book cover typography (Cover Builder V2).
//
// OWNER LAW `cover_v2_deterministic_typography` (2026-07-22, PERMANENT):
//   12 typography style families define the artistic recipe for the
//   deterministic title layer. The Art Director picks one per book based on
//   category/theme/age plus a recency-avoidance window so the catalog
//   reads as visually diverse. The renderer maps the recipe to the
//   existing `renderKidsTitleTreatment` per-letter engine.

export type StyleFamilyId =
  | "magical_storybook"
  | "bold_cartoon_adventure"
  | "space_sci"
  | "fantasy_dragon"
  | "futuristic_neon"
  | "cute_preschool"
  | "nature_woodland"
  | "retro_comic"
  | "elegant_illustrated_serif"
  | "hand_drawn_playful"
  | "epic_cinematic"
  | "japanese_graphic";

export interface StyleFamily {
  id: StyleFamilyId;
  label: string;
  /** Themes this family suits (regex-tested against title + theme string). */
  themePattern: RegExp;
  /** Age bands this family suits (inclusive min/max age). */
  ageRange: [number, number];
  /** Renderer jitter recipe. */
  jitterDeg: number;
  yBouncePx: number;
  tiltDeg: number;
  /** Outline stack: [outer, inner] widths as fractions of font size. */
  outerStrokeFrac: number;
  innerStrokeFrac: number;
  /** Whether to render an extra outer white stroke. */
  extraStroke: boolean;
  /** Fill treatment. */
  fill: "warm_cream" | "gradient_sunset" | "cool_ice" | "vibrant_primary"
    | "neon_glow" | "pastel_soft" | "earthy_natural" | "comic_pop"
    | "elegant_ivory" | "sketchy_paper" | "cinematic_metallic" | "graphic_flat";
  /** Decoration set drawn around the title. */
  decorations: Array<"stars" | "sparkles" | "gears" | "leaves" | "berries"
    | "moons" | "sockets" | "dots" | "arrows" | "flames" | "bubbles"
    | "petals" | "nebula" | "circuits" | "swashes">;
  /** Preferred layout families (see layout-families.ts). */
  preferredLayouts: LayoutFamilyId[];
  /** Max title character length that works well in this family. */
  maxTitleChars: number;
}

export type LayoutFamilyId =
  | "top_hero_below"
  | "center_integrated"
  | "character_overlap"
  | "hero_word_subtitle"
  | "stacked_frame"
  | "curved_above"
  | "themed_badge"
  | "split_around_hero"
  | "cinematic_bottom"
  | "full_height";

export const STYLE_FAMILIES: Record<StyleFamilyId, StyleFamily> = {
  magical_storybook: {
    id: "magical_storybook", label: "Magical Storybook",
    themePattern: /\b(magic|unicorn|fairy|princess|star|moon|dream|wish|sparkle|rainbow)\b/i,
    ageRange: [3, 8], jitterDeg: 3.5, yBouncePx: 8, tiltDeg: -1,
    outerStrokeFrac: 0.14, innerStrokeFrac: 0.09, extraStroke: true,
    fill: "gradient_sunset", decorations: ["stars", "sparkles", "moons"],
    preferredLayouts: ["top_hero_below", "stacked_frame", "curved_above"],
    maxTitleChars: 40,
  },
  bold_cartoon_adventure: {
    id: "bold_cartoon_adventure", label: "Bold Cartoon Adventure",
    themePattern: /\b(adventure|quest|hero|racing|pirate|explorer|jungle|safari|dinosaur|monster)\b/i,
    ageRange: [4, 10], jitterDeg: 5, yBouncePx: 12, tiltDeg: -2,
    outerStrokeFrac: 0.18, innerStrokeFrac: 0.10, extraStroke: true,
    fill: "vibrant_primary", decorations: ["arrows", "sparkles", "dots"],
    preferredLayouts: ["cinematic_bottom", "character_overlap", "top_hero_below"],
    maxTitleChars: 44,
  },
  space_sci: {
    id: "space_sci", label: "Space & Sci-Fi",
    themePattern: /\b(space|planet|astronaut|galaxy|rocket|alien|nebula|cosmic|star|orbit|robot|cyber)\b/i,
    ageRange: [5, 12], jitterDeg: 1.5, yBouncePx: 4, tiltDeg: 0,
    outerStrokeFrac: 0.12, innerStrokeFrac: 0.06, extraStroke: false,
    fill: "cool_ice", decorations: ["nebula", "stars", "circuits"],
    preferredLayouts: ["hero_word_subtitle", "cinematic_bottom", "full_height"],
    maxTitleChars: 42,
  },
  fantasy_dragon: {
    id: "fantasy_dragon", label: "Fantasy Dragon",
    themePattern: /\b(dragon|wizard|castle|knight|mythic|beast|enchanted|kingdom)\b/i,
    ageRange: [5, 12], jitterDeg: 2.5, yBouncePx: 6, tiltDeg: -1.5,
    outerStrokeFrac: 0.16, innerStrokeFrac: 0.10, extraStroke: true,
    fill: "cinematic_metallic", decorations: ["flames", "swashes", "sparkles"],
    preferredLayouts: ["curved_above", "stacked_frame", "themed_badge"],
    maxTitleChars: 40,
  },
  futuristic_neon: {
    id: "futuristic_neon", label: "Futuristic Neon",
    themePattern: /\b(neon|cyber|tech|future|arcade|glow|electric|virtual|hack|code)\b/i,
    ageRange: [8, 14], jitterDeg: 1, yBouncePx: 3, tiltDeg: 0,
    outerStrokeFrac: 0.10, innerStrokeFrac: 0.05, extraStroke: false,
    fill: "neon_glow", decorations: ["circuits", "sparkles", "dots"],
    preferredLayouts: ["hero_word_subtitle", "split_around_hero", "cinematic_bottom"],
    maxTitleChars: 38,
  },
  cute_preschool: {
    id: "cute_preschool", label: "Cute Preschool",
    themePattern: /\b(baby|toddler|little|tiny|cute|hug|cuddle|first|abc|123|kitten|puppy)\b/i,
    ageRange: [2, 5], jitterDeg: 4, yBouncePx: 10, tiltDeg: 0,
    outerStrokeFrac: 0.18, innerStrokeFrac: 0.11, extraStroke: true,
    fill: "pastel_soft", decorations: ["dots", "sparkles", "petals"],
    preferredLayouts: ["top_hero_below", "themed_badge", "stacked_frame"],
    maxTitleChars: 36,
  },
  nature_woodland: {
    id: "nature_woodland", label: "Nature & Woodland",
    themePattern: /\b(forest|woodland|tree|garden|bird|bug|flower|meadow|farm|animal|barn|nature)\b/i,
    ageRange: [3, 9], jitterDeg: 3, yBouncePx: 6, tiltDeg: -1,
    outerStrokeFrac: 0.13, innerStrokeFrac: 0.08, extraStroke: false,
    fill: "earthy_natural", decorations: ["leaves", "berries", "petals"],
    preferredLayouts: ["curved_above", "top_hero_below", "themed_badge"],
    maxTitleChars: 42,
  },
  retro_comic: {
    id: "retro_comic", label: "Retro Comic",
    themePattern: /\b(comic|super|hero|zap|pow|bam|villain|city|caped)\b/i,
    ageRange: [5, 12], jitterDeg: 4, yBouncePx: 9, tiltDeg: -3,
    outerStrokeFrac: 0.17, innerStrokeFrac: 0.10, extraStroke: true,
    fill: "comic_pop", decorations: ["arrows", "dots", "sparkles"],
    preferredLayouts: ["character_overlap", "cinematic_bottom", "hero_word_subtitle"],
    maxTitleChars: 40,
  },
  elegant_illustrated_serif: {
    id: "elegant_illustrated_serif", label: "Elegant Illustrated Serif",
    themePattern: /\b(botanical|floral|vintage|classic|elegant|heritage|tea|birds|watercolor)\b/i,
    ageRange: [8, 16], jitterDeg: 0.5, yBouncePx: 2, tiltDeg: 0,
    outerStrokeFrac: 0.08, innerStrokeFrac: 0.04, extraStroke: false,
    fill: "elegant_ivory", decorations: ["swashes", "petals", "leaves"],
    preferredLayouts: ["curved_above", "stacked_frame", "themed_badge"],
    maxTitleChars: 44,
  },
  hand_drawn_playful: {
    id: "hand_drawn_playful", label: "Hand-Drawn Playful",
    themePattern: /\b(doodle|scribble|silly|goofy|mess|paint|craft|art)\b/i,
    ageRange: [4, 10], jitterDeg: 6, yBouncePx: 12, tiltDeg: -2,
    outerStrokeFrac: 0.16, innerStrokeFrac: 0.10, extraStroke: true,
    fill: "sketchy_paper", decorations: ["sparkles", "dots", "swashes"],
    preferredLayouts: ["character_overlap", "top_hero_below", "curved_above"],
    maxTitleChars: 42,
  },
  epic_cinematic: {
    id: "epic_cinematic", label: "Epic Cinematic",
    themePattern: /\b(epic|legend|quest|battle|warrior|shadow|realm|chronicles|saga)\b/i,
    ageRange: [8, 16], jitterDeg: 0.5, yBouncePx: 2, tiltDeg: 0,
    outerStrokeFrac: 0.14, innerStrokeFrac: 0.08, extraStroke: true,
    fill: "cinematic_metallic", decorations: ["flames", "swashes", "sparkles"],
    preferredLayouts: ["cinematic_bottom", "hero_word_subtitle", "full_height"],
    maxTitleChars: 42,
  },
  japanese_graphic: {
    id: "japanese_graphic", label: "Japanese Graphic",
    themePattern: /\b(anime|manga|kawaii|ninja|samurai|sakura|tokyo|onigiri|ramen)\b/i,
    ageRange: [6, 14], jitterDeg: 1, yBouncePx: 3, tiltDeg: 0,
    outerStrokeFrac: 0.12, innerStrokeFrac: 0.07, extraStroke: true,
    fill: "graphic_flat", decorations: ["petals", "sparkles", "dots"],
    preferredLayouts: ["split_around_hero", "hero_word_subtitle", "themed_badge"],
    maxTitleChars: 40,
  },
};

export const ALL_FAMILY_IDS: StyleFamilyId[] = Object.keys(STYLE_FAMILIES) as StyleFamilyId[];

/** Pick a style family from title/theme/age, avoiding recent picks. */
export function pickStyleFamily(input: {
  title: string;
  theme?: string | null;
  ageBand?: string | null; // e.g. "4-6"
  recentFamilies?: StyleFamilyId[]; // last N picks — avoid these
}): StyleFamily {
  const hay = `${input.title ?? ""} ${input.theme ?? ""}`.toLowerCase();
  const ageMid = parseAgeMid(input.ageBand ?? "");
  const recent = new Set(input.recentFamilies ?? []);

  // Score each family. Higher is better.
  const scored = ALL_FAMILY_IDS.map((id) => {
    const f = STYLE_FAMILIES[id];
    let score = 0;
    if (f.themePattern.test(hay)) score += 10;
    if (ageMid != null && ageMid >= f.ageRange[0] && ageMid <= f.ageRange[1]) score += 3;
    if (input.title.length <= f.maxTitleChars) score += 1;
    if (recent.has(id)) score -= 6; // recency avoidance
    // Deterministic tie-break by stable seed of title.
    score += deterministicNoise(input.title + id) * 0.5;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return STYLE_FAMILIES[scored[0].id];
}

function parseAgeMid(band: string): number | null {
  const m = band.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (!m) return null;
  return (Number(m[1]) + Number(m[2])) / 2;
}

function deterministicNoise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
