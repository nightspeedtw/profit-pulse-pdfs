// Master Cover Prompt — canonical prompt for COLORING BOOK covers ONLY.
//
// OWNER LAW `cover_bake_only_v6` (2026-07-21):
//   Ideogram bakes EVERYTHING: the exact title AND a small integrated
//   "Ages X-Y" label. NO SVG/HTML text overlay is ever composited on top.
//   If Ideogram cannot render the title cleanly, we retry with a stronger
//   spelling contract — we never fall back to overlay typography, because
//   overlay typography always looks like a plastered popup.
//
// Scope: `book_type='coloring_book'` only. Picture-book / adult covers must
// not import from here.
//
// @ts-nocheck  Deno edge runtime

export const COLORING_MASTER_COVER_PROMPT_VERSION = "coloring_master_cover_v6_bake_only";

export type ColoringCoverStyleMode = "default" | "ya_scifi_cinematic";

export interface MasterColoringCoverInput {
  title: string;
  subtitle?: string;
  /** e.g. "Ages 4-6". Baked INTO the illustration as a small integrated label. */
  ageBadge: string;
  theme: string;
  mainCharacters: string[];
  backgroundElements: string[];
  aspectDescriptor?: string;
  categoryName?: string;
  hasInteriorReferences?: boolean;
  styleMode?: ColoringCoverStyleMode;
}

const BANNED_WORDS = ["watermark", "logo", "page number", "website"];

/** Normalise an age band into a clean baked label. "4-6" → "Ages 4-6". */
function normalizeAgeBadge(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^ages?\s/i.test(s)) return s.replace(/^ages?\s+/i, "Ages ");
  if (/^\d+\s*[-–—]\s*\d+$/.test(s)) return `Ages ${s.replace(/\s+/g, "")}`;
  return `Ages ${s}`;
}

export function buildMasterColoringCoverPrompt(input: MasterColoringCoverInput): string {
  const title = (input.title ?? "").trim();
  const ageBadge = normalizeAgeBadge(input.ageBadge);
  const theme = (input.theme ?? input.categoryName ?? "cheerful children's coloring theme").trim();
  const mains = (input.mainCharacters ?? []).filter(Boolean).slice(0, 3);
  const bgs = (input.backgroundElements ?? []).filter(Boolean).slice(0, 8);
  const aspect = (input.aspectDescriptor ?? "8.5 x 8.5 inches, square 1:1").trim();
  const mainStr = mains.length ? mains.join(", ") : "1-3 adorable friendly characters that fit the theme";
  const bgStr = bgs.length ? bgs.join(", ") : "soft pastel scenery, gentle clouds, sparkles";

  const refClause = input.hasInteriorReferences
    ? "The attached interior pages are visual REFERENCE ONLY for theme, character design, line style, and age level. Do NOT copy, paste, trace, or reuse any interior page directly. REDRAW and REINTERPRET the characters and scene as a brand-new, commercially marketable cover illustration."
    : "";

  const ageClause = ageBadge
    ? `Also paint a small integrated hand-drawn "${ageBadge}" mark near the bottom of the cover as part of the illustration itself — as if the illustrator lettered it directly on the artwork. It must feel like natural cover art (rounded, playful, hand-drawn), NOT a sticker, badge, ribbon, chip, banner, or pill. Keep it small and unobtrusive, integrated with the color palette.`
    : "";

  const textElementsClause = `The ONLY text anywhere in the image is the title spelled EXACTLY "${title}"${ageBadge ? ` and the small integrated "${ageBadge}" mark described above` : ""}. Absolutely no subtitle, no tagline, no "COLORING BOOK" chip on top of the title, no page count, no publisher, no author name, no descriptor sentence, no sound-effect word, no banner text, no sticker text, no SALE ribbon, no character name caption, no letter-shaped ornaments. Every decorative shape must be a pure graphic (star, dot, heart, spark, geometric fragment) — NEVER a letter or word beyond the two allowed strings.`;

  const spellingContract = `SPELLING CONTRACT — the title must read EXACTLY "${title}". Count the letters and check twice. Do NOT invent, drop, duplicate, transpose, hyphenate, split, or join any letter.${ageBadge ? ` The age mark must read EXACTLY "${ageBadge}" — no other digits, no other age word.` : ""}`;

  const layoutClause = `The title must use large CUSTOM HAND-DRAWN illustrated lettering with a thick clean outline and warm fill colors, bold and rounded and playful, integrated with the theme (subtle themed accents like stars/hearts/sparkles are welcome). Place the title inside the upper 30-40% of the cover with generous breathing room.${ageBadge ? ` Place the small "${ageBadge}" mark in the lower 12% of the cover, tucked into the artwork, small and integrated.` : ""}`;

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
  const negative = `NEGATIVE — no watermark, no logo, no page numbers, no website URL, no subtitle, no tagline, no descriptor word, no misspelled words, no duplicated title, no SALE ribbon, no sticker badge, no chip label, no popup pill, no line-art, no black-outline-only illustration, no uncolored coloring-page look, no flat vector, no plain fill, no photograph, no 3D CGI plastic look, no cluttered composition, no gore, no missing limbs, no extra limbs, no deformed anatomy.`;

  const prompt = [
    openingClause,
    refClause,
    `Book title: "${title}".`,
    ageBadge ? `Age mark to paint: "${ageBadge}".` : "",
    `Theme: ${theme}.`,
    `Main characters: ${mainStr}.`,
    `Background elements: ${bgStr}.`,
    `Canvas size: ${aspect} front cover.`,
    heroClause,
    layoutClause,
    ageClause,
    `SAFE-AREA — every important element stays at least 0.25 inches from the trim edge (interior 92% of canvas). Nothing may be cropped by the edge.`,
    paletteClause,
    textElementsClause,
    spellingContract,
    styleTag,
    negative,
  ].filter(Boolean).join(" ");

  return capAndAssert(prompt, { title, ageBadge });
}

function capAndAssert(prompt: string, expected: { title: string; ageBadge: string }): string {
  const capped = prompt.length > 3200 ? prompt.slice(0, 3190) + " ..." : prompt;
  assertMasterPromptShape(capped, expected);
  return capped;
}

export function assertMasterPromptShape(
  prompt: string,
  expected: { title: string; ageBadge?: string },
): void {
  if (typeof prompt !== "string" || prompt.length < 200) {
    throw new Error("coloring_master_cover_v6: prompt is empty or too short");
  }
  if (prompt.length > 3200) {
    throw new Error(`coloring_master_cover_v6: prompt exceeds 3200 chars (${prompt.length})`);
  }
  if (!expected.title || expected.title.length < 1) {
    throw new Error("coloring_master_cover_v6: expected.title is empty");
  }
  if (!prompt.includes(expected.title)) {
    throw new Error(`coloring_master_cover_v6: prompt is missing verbatim title "${expected.title}"`);
  }
  if (expected.ageBadge && !prompt.includes(expected.ageBadge)) {
    throw new Error(`coloring_master_cover_v6: prompt is missing verbatim ageBadge "${expected.ageBadge}"`);
  }
  const lower = prompt.toLowerCase();
  for (const banned of BANNED_WORDS) {
    let idx = 0;
    while (true) {
      const at = lower.indexOf(banned, idx);
      if (at < 0) break;
      const prefix = lower.slice(Math.max(0, at - 4), at);
      if (!/no\s$/.test(prefix)) {
        throw new Error(`coloring_master_cover_v6: banned word "${banned}" not inside a negative clause`);
      }
      idx = at + banned.length;
    }
  }
}
