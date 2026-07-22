// Textless coloring cover prompt (Cover Builder V2).
//
// OWNER LAW `cover_v2_deterministic_typography` (2026-07-22, PERMANENT):
//   The illustration model must produce a TEXTLESS artwork with a
//   deliberately DESIGNED title environment (ribbon, sky panel, magic
//   smoke, shield, bookplate, cloud, badge frame, arch, banner shape).
//   NO glyphs. NO letters. NO numbers. NO words. The deterministic
//   typography renderer will then bake the exact canonical title into
//   that title environment and flatten the result into the master cover.

export const COLORING_TEXTLESS_COVER_PROMPT_VERSION = "coloring_textless_cover_v7";

export type ColoringCoverStyleMode = "default" | "ya_scifi_cinematic";

export interface TextlessCoverInput {
  /** Canonical title — used ONLY to derive title-environment mood; NOT to bake. */
  title: string;
  theme: string;
  mainCharacters: string[];
  backgroundElements: string[];
  /** Recommended layout family (from Art Director). */
  layoutFamily: string;
  /** Recommended style-family label. */
  styleFamilyLabel: string;
  aspectDescriptor?: string;
  hasInteriorReferences?: boolean;
  styleMode?: ColoringCoverStyleMode;
  /** Named title-environment shape the illustrator should paint. */
  titleEnvironment: string;
  /** Ratio-safe zone hint, e.g. "upper 35%" or "central band". */
  titleZoneDescriptor: string;
}

const NEGATIVE_TEXTLESS =
  "no letters, no numbers, no words, no writing, no text, no title, no subtitle, no author name, no publisher, no watermark, no logo, no page number, no signage, no book title bar, no chip label, no ribbon text, no banner text, no sticker text, no calligraphy, no gibberish glyphs, no letter-shaped ornaments, no fake writing, no scribbled words, no speech bubble text";

export function buildTextlessColoringCoverPrompt(input: TextlessCoverInput): string {
  const theme = (input.theme ?? "children's coloring theme").trim();
  const aspect = (input.aspectDescriptor ?? "8.5 x 8.5 inches, square 1:1").trim();
  const mains = (input.mainCharacters ?? []).filter(Boolean).slice(0, 3);
  const bgs = (input.backgroundElements ?? []).filter(Boolean).slice(0, 6);
  const isYA = input.styleMode === "ya_scifi_cinematic";

  const opening = isYA
    ? "Create a PREMIUM PROFESSIONAL GRAPHIC-NOVEL KEY-ART cover illustration for a teen coloring book — cinematic movie-poster energy, painterly digital illustration."
    : "Create a PREMIUM BESTSELLER children's coloring-book cover ILLUSTRATION — richly saturated painterly digital art in a professional book-cover art direction.";

  const hero = mains.length
    ? `Hero(es): ${mains.join(", ")}, expressive face(s), dynamic pose, professional storybook lighting with rim-light and warm highlight.`
    : "ONE clear focal hero character with expressive face, big kind eyes and a dynamic pose.";

  const background = bgs.length
    ? `Background elements: ${bgs.join(", ")}, arranged as foreground / midground / background layers with real depth.`
    : "Themed atmospheric background with real depth — foreground / midground / background layers.";

  const titleEnv =
    `IMPORTANT — leave the ${input.titleZoneDescriptor} of the canvas as an intentionally DESIGNED title environment shaped like ${input.titleEnvironment}. ` +
    `Paint this shape as a NATURAL part of the illustration (ornament, cloud, ribbon, banner shape, magic smoke, shield, arch, bookplate frame, sky panel, glowing panel, wreath, badge, scroll) so a title can be added later inside it. ` +
    `The zone must have a calmer, higher-contrast background so a title placed inside it will read cleanly. Do NOT draw any letters, words or text inside or around this zone.`;

  const refClause = input.hasInteriorReferences
    ? "The attached interior pages are visual REFERENCE ONLY for character design, line style, and age level. Do NOT copy, trace, or reuse any interior page. REDRAW as a brand-new cover illustration."
    : "";

  const styleTag = isYA
    ? `Style: ${input.styleFamilyLabel} × premium YA sci-fi graphic-novel key-art book cover, cinematic movie-poster feel, painterly digital illustration, print-ready.`
    : `Style: ${input.styleFamilyLabel} × premium bestseller children's coloring-book cover illustration, rich painterly rendering, professional art direction, print-ready.`;

  const layoutHint = `Compositional layout family: ${input.layoutFamily}.`;

  const negative =
    `NEGATIVE — ${NEGATIVE_TEXTLESS}, no flat vector, no black-outline-only illustration, no uncolored coloring-page look, no photograph, no 3D CGI plastic look, no cluttered composition, no gore, no missing limbs, no extra limbs, no deformed anatomy.`;

  const prompt = [
    opening,
    refClause,
    `Theme: ${theme}.`,
    hero,
    background,
    `Canvas size: ${aspect} front cover.`,
    layoutHint,
    titleEnv,
    "SAFE-AREA — every important element stays at least 0.25 inches from the trim edge (interior 92% of canvas).",
    styleTag,
    negative,
  ].filter(Boolean).join(" ");

  return capAndAssert(prompt);
}

function capAndAssert(prompt: string): string {
  const capped = prompt.length > 3200 ? prompt.slice(0, 3190) + " ..." : prompt;
  if (capped.length < 200) throw new Error("coloring_textless_cover_v7: prompt too short");
  // Refuse to ship a prompt that would ask for glyphs.
  const bad = /\b(spelling|title reads|exact title|bake the title|paint the title|render the title)\b/i;
  if (bad.test(capped)) throw new Error("coloring_textless_cover_v7: prompt requests baked glyphs");
  return capped;
}
