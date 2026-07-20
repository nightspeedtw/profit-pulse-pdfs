// Master Cover Prompt — canonical prompt for COLORING BOOK covers ONLY.
//
// OWNER LAW `cover_text_overlay_only_v2` (2026-07-20):
//   Ideogram bakes AT MOST the big display title — nothing else. Subtitle,
//   blurb paragraph, age badge, "Coloring Book" label, SALE ribbon are ALL
//   drawn by the deterministic overlay layer. This is the only structurally
//   sound way to guarantee zero spelling errors ship: AI image models cannot
//   reliably spell multi-line body text.
//
//   Two modes:
//     • title-only bake (default): prompt asks for the exact title + zero
//       other text of any kind.
//     • textless (fallback): prompt asks for ZERO text at all — the overlay
//       layer will draw the title too (used after 3 title-only rejects).
//
// Scope: `book_type='coloring_book'` only. Picture-book / adult covers must
// not import from here.
//
// @ts-nocheck  Deno edge runtime

export const COLORING_MASTER_COVER_PROMPT_VERSION = "coloring_master_cover_v4_title_only_or_textless";

export type ColoringCoverStyleMode = "default" | "ya_scifi_cinematic";
export type ColoringCoverTextMode = "title_only" | "textless";

export interface MasterColoringCoverInput {
  title: string;
  subtitle: string;                    // IGNORED for baking; kept for backwards-compat + overlay reads it
  ageBadge: string;                    // OVERLAY-drawn; used only for prompt-shape assertion (may be blank)
  theme: string;
  mainCharacters: string[];
  backgroundElements: string[];
  aspectDescriptor?: string;
  categoryName?: string;
  hasInteriorReferences?: boolean;
  styleMode?: ColoringCoverStyleMode;
  /** OWNER LAW v2: "title_only" bakes only the title; "textless" bakes zero
   *  text (used when 3 title-only retries still ship gibberish extras). */
  textMode?: ColoringCoverTextMode;
}

const BANNED_WORDS = ["watermark", "logo", "page number", "website"];

export function buildMasterColoringCoverPrompt(input: MasterColoringCoverInput): string {
  const title = (input.title ?? "").trim();
  const theme = (input.theme ?? input.categoryName ?? "cheerful children's coloring theme").trim();
  const mains = (input.mainCharacters ?? []).filter(Boolean).slice(0, 3);
  const bgs = (input.backgroundElements ?? []).filter(Boolean).slice(0, 8);
  const aspect = (input.aspectDescriptor ?? "8.5 x 8.5 inches, square 1:1").trim();
  const mainStr = mains.length ? mains.join(", ") : "1-3 adorable friendly characters that fit the theme";
  const bgStr = bgs.length ? bgs.join(", ") : "soft pastel scenery, gentle clouds, sparkles";
  const textMode: ColoringCoverTextMode = input.textMode ?? "title_only";

  const refClause = input.hasInteriorReferences
    ? "The attached interior pages are visual REFERENCE ONLY for theme, character design, line style, and age level. Do NOT copy, paste, trace, or reuse any interior page directly. REDRAW and REINTERPRET the characters and scene as a brand-new, commercially marketable cover illustration."
    : "";

  // OWNER LAW `cover_text_overlay_only_v2`:
  //   title_only  → bake ONLY the exact title, zero other text
  //   textless    → bake ZERO text, period — overlay will draw the title
  const isTitleOnly = textMode === "title_only";
  const textElementsClause = isTitleOnly
    ? `The ONLY text anywhere in the image is the title, spelled EXACTLY "${title}". Absolutely no subtitle, no tagline, no age label, no "AGES" text, no "COLORING BOOK" text, no page count, no publisher, no author name, no descriptor sentence, no sound-effect word, no banner text, no sticker text, no character name caption, no letter-shaped ornaments. Every decorative shape must be a pure graphic (star, dot, heart, spark, geometric fragment) — NEVER a letter or word.`
    : `The image contains ZERO baked text of any kind. No title, no subtitle, no tagline, no age label, no badge, no ribbon, no sticker, no page count, no publisher, no watermark, no signature, no sound-effect word, no character name caption. Every decorative element must be a pure graphic shape (star, dot, heart, spark, geometric fragment) — NEVER a letter or word. The title will be added later in a separate typography pass.`;

  const spellingContract = isTitleOnly
    ? `SPELLING CONTRACT — the title must read EXACTLY "${title}". Count the letters and check twice. Do NOT invent, drop, duplicate, transpose, hyphenate, split, or join any letter. If the title cannot be rendered without spelling errors, render the cover TEXTLESS and let the overlay pass add the title.`
    : `TEXTLESS CONTRACT — this is a fully textless illustration. If any glyph appears, the cover is rejected.`;

  const layoutClause = isTitleOnly
    ? `The title must use large CUSTOM HAND-DRAWN illustrated lettering with a thick clean outline and warm fill colors, bold and rounded and playful, integrated with the theme (subtle themed accents like stars/hearts/sparkles are welcome). Place the title inside the upper 30-40% of the cover with generous breathing room. Do NOT draw any subtitle, tagline, badge, ribbon, banner, sticker, or corner text — those come from a separate layer.`
    : `Reserve the upper 35% of the cover as clean visual "sky" (soft matching color, low-frequency background) so a title overlay can be composited there without collision. Reserve the bottom 18% of the cover as clean visual "ground" (matching color band, low-frequency) so a subtitle/blurb banner overlay can be composited there.`;

  const isYA = input.styleMode === "ya_scifi_cinematic";
  const openingClause = isYA
    ? `Create a PREMIUM PROFESSIONAL GRAPHIC-NOVEL KEY-ART cover for a teen/young-adult coloring book (ages 13-17). Cinematic movie-poster energy, magazine-quality painterly digital illustration — NOT flat, NOT line-art, NOT a coloring page.`
    : `Create a PREMIUM AMAZON KDP BESTSELLER children's coloring-book cover. RICH SATURATED FULL-COLOR polished digital illustration, painterly rendering, professional book-cover art direction — NOT flat, NOT line-art, NOT a coloring page.`;
  const heroClause = isYA
    ? `ONE clear teen protagonist in a dynamic 3/4 cinematic hero pose with wind-swept hair, confident expression, contemporary sci-fi wardrobe. Painterly rendering with detailed shading, rim-light, expressive eyes. Cinematic sci-fi background with real depth: neon skyline, rain, lightning, atmospheric fog, holographic UI — foreground / midground / background layers.`
    : `ONE clear focal hero character (or a tight group of 1-3 friends), expressive face, big kind eyes, dynamic pose, detailed costume, professional lighting with soft shadow / rim-light / warm highlight. Themed atmospheric background with real depth matching the book's theme — foreground / midground / background layers.`;
  const paletteClause = isYA
    ? `FULL-COLOR CINEMATIC PAINTED ILLUSTRATION. Bold YA color grade: deep indigo/navy, electric cyan and violet accents, hot magenta highlights, lightning-white sparks, dramatic contrast, atmospheric depth, moody volumetric lighting. Painterly finish — NOT flat vector, NOT line-art.`
    : `FULL-COLOR RICH SATURATED PAINTED ILLUSTRATION in the style of a bestseller children's picture book / KDP-bestseller coloring-book cover. Vibrant confident colors (deep sky-blue, sunlit yellow, warm coral, emerald, magenta, gold), professional color grading, dramatic hero lighting, painterly brush texture. Painterly, polished, storybook-illustration quality.`;
  const styleTag = isYA
    ? `Style: premium YA sci-fi graphic-novel key-art book cover, cinematic movie-poster feel, painterly digital illustration, high-resolution print-ready.`
    : `Style: premium bestseller Amazon KDP children's coloring-book cover, rich saturated painterly illustration, professional art direction, high-resolution print-ready.`;
  const negative = `NEGATIVE — no watermark, no logo, no page numbers, no website URL, no subtitle, no tagline, no descriptor word, no misspelled words, no duplicated title, no age label, no baked badge, no baked ribbon, no line-art, no black-outline-only illustration, no uncolored coloring-page look, no flat vector, no plain fill, no photograph, no 3D CGI plastic look, no cluttered composition, no gore, no missing limbs, no extra limbs, no deformed anatomy.`;

  const prompt = [
    openingClause,
    refClause,
    isTitleOnly ? `Book title: "${title}".` : `(Book title will be added by a separate overlay pass — do NOT paint it.)`,
    `Theme: ${theme}.`,
    `Main characters: ${mainStr}.`,
    `Background elements: ${bgStr}.`,
    `Canvas size: ${aspect} front cover.`,
    heroClause,
    layoutClause,
    `SAFE-AREA — every important element stays at least 0.25 inches from the trim edge (interior 92% of canvas). Nothing may be cropped by the edge.`,
    paletteClause,
    textElementsClause,
    spellingContract,
    styleTag,
    negative,
  ].filter(Boolean).join(" ");

  return capAndAssert(prompt, { title, textMode });
}

function capAndAssert(prompt: string, expected: { title: string; textMode: ColoringCoverTextMode }): string {
  const capped = prompt.length > 3000 ? prompt.slice(0, 2990) + " ..." : prompt;
  assertMasterPromptShape(capped, expected);
  return capped;
}

export function assertMasterPromptShape(
  prompt: string,
  expected: { title: string; textMode?: ColoringCoverTextMode },
): void {
  if (typeof prompt !== "string" || prompt.length < 200) {
    throw new Error("coloring_master_cover_v2: prompt is empty or too short");
  }
  if (prompt.length > 3000) {
    throw new Error(`coloring_master_cover_v2: prompt exceeds 3000 chars (${prompt.length})`);
  }
  const textMode = expected.textMode ?? "title_only";
  if (textMode === "title_only") {
    if (!expected.title || expected.title.length < 1) {
      throw new Error("coloring_master_cover_v2: expected.title is empty");
    }
    if (!prompt.includes(expected.title)) {
      throw new Error(`coloring_master_cover_v2: prompt is missing verbatim title "${expected.title}"`);
    }
  } else {
    if (prompt.includes(`"${expected.title}"`)) {
      throw new Error("coloring_master_cover_v2: textless prompt must not embed the title string");
    }
    if (!/textless|zero.*text|no.*text/i.test(prompt)) {
      throw new Error("coloring_master_cover_v2: textless prompt missing zero-text clause");
    }
  }
  const lower = prompt.toLowerCase();
  for (const banned of BANNED_WORDS) {
    let idx = 0;
    while (true) {
      const at = lower.indexOf(banned, idx);
      if (at < 0) break;
      const prefix = lower.slice(Math.max(0, at - 4), at);
      if (!/no\s$/.test(prefix)) {
        throw new Error(`coloring_master_cover_v2: banned word "${banned}" not inside a negative clause`);
      }
      idx = at + banned.length;
    }
  }
}
