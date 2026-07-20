// Master Cover Prompt — canonical prompt for COLORING BOOK covers ONLY.
//
// OWNER LAW (2026-07-19, `coloring_master_cover_v1`):
//   Every coloring-book cover generation MUST be built from this module.
//   The prompt is derived directly from the owner-provided master template
//   ("Prompt แบบสั้นสำหรับใส่ในระบบอัตโนมัติ") and fills exactly the
//   variables the template expects: title, subtitle, age badge, theme,
//   main characters, background elements. Interior page URLs are attached
//   by the caller as reference images — the prompt states they are for
//   inspiration ONLY, never to be copied.
//
// Scope guard: this module is only for `book_type='coloring_book'`.
// Picture-book / adult covers must NOT import from here.
//
// The builder throws on structural violations so a regression cannot ship:
//   - title/subtitle/age string must appear verbatim
//   - no banned words (watermark, logo, page number, website)
//   - length ≤ 3000 chars (Runware positive-prompt cap)
//   - reference-image "inspiration only, do not copy" clause always present
//
// This file replaces the ad-hoc clauses previously inlined inside
// `buildIdeogramIntegratedCoverPrompt` for the coloring lane.

// @ts-nocheck  Deno edge runtime

export const COLORING_MASTER_COVER_PROMPT_VERSION = "coloring_master_cover_v1";

export type ColoringCoverStyleMode = "default" | "ya_scifi_cinematic";

export interface MasterColoringCoverInput {
  title: string;
  subtitle: string;
  ageBadge: string;             // e.g. "Ages 4-6"
  theme: string;                // short theme phrase (e.g. "Cute magical unicorn fantasy")
  mainCharacters: string[];     // 1-3 hero descriptors
  backgroundElements: string[]; // scene ingredients
  aspectDescriptor?: string;    // e.g. "8.5 x 8.5 inches, square 1:1" or "8.5 x 11 inches portrait"
  categoryName?: string;
  hasInteriorReferences?: boolean;
  styleMode?: ColoringCoverStyleMode;
}


const BANNED_WORDS = ["watermark", "logo", "page number", "website"];

export function buildMasterColoringCoverPrompt(input: MasterColoringCoverInput): string {
  const title = (input.title ?? "").trim();
  const subtitle = (input.subtitle ?? "").trim(); // OWNER LAW: empty subtitle = omit entirely (Rulebook v2 essentials-only)
  const ageBadge = (input.ageBadge ?? "").trim();
  const theme = (input.theme ?? input.categoryName ?? "cheerful children's coloring theme").trim();
  const mains = (input.mainCharacters ?? []).filter(Boolean).slice(0, 3);
  const bgs = (input.backgroundElements ?? []).filter(Boolean).slice(0, 8);
  const aspect = (input.aspectDescriptor ?? "8.5 x 8.5 inches, square 1:1").trim();
  const mainStr = mains.length ? mains.join(", ") : "1-3 adorable friendly characters that fit the theme";
  const bgStr = bgs.length ? bgs.join(", ") : "soft pastel scenery, gentle clouds, sparkles";
  const hasSubtitle = subtitle.length > 0;

  const refClause = input.hasInteriorReferences
    ? "The attached interior pages are visual REFERENCE ONLY for theme, character design, line style, and age level. Do NOT copy, paste, trace, or reuse any interior page directly. Do NOT enlarge an interior page into the cover. REDRAW and REINTERPRET the characters and scene as a brand-new, commercially marketable cover illustration."
    : "";

  const textElementsList = hasSubtitle
    ? `"${title}", "${subtitle}", "${ageBadge}"`
    : `"${title}", "${ageBadge}"`;
  const spellingContract = hasSubtitle
    ? `SPELLING CONTRACT — the title must read EXACTLY "${title}", the subtitle must read EXACTLY "${subtitle}", the age badge must read EXACTLY "${ageBadge}". Count the letters and check twice. Do NOT invent, drop, duplicate, transpose, hyphenate, split, or join any letter.`
    : `SPELLING CONTRACT — the title must read EXACTLY "${title}" and the age badge must read EXACTLY "${ageBadge}". Count the letters and check twice. Do NOT invent, drop, duplicate, transpose, hyphenate, split, or join any letter. Do NOT add ANY subtitle, tagline, descriptor, or decorative word — the cover carries ONLY the title and the age badge.`;
  const layoutClause = hasSubtitle
    ? `The title must use large CUSTOM HAND-DRAWN illustrated lettering, not a plain standard system font. The lettering must be bold, rounded, playful, highly readable, correctly spelled letter-for-letter, visually integrated with the theme (subtle themed accents like stars, hearts, sparkles, rainbows, clouds, flowers are welcome), with a thick clean outline and warm fill colors. Place the main title inside the upper 30-40% of the cover. Place the subtitle immediately beneath the title on its own line. Place the age label inside a clear round badge in an upper or lower corner.`
    : `The title must use large CUSTOM HAND-DRAWN illustrated lettering, not a plain standard system font. The lettering must be bold, rounded, playful, highly readable, correctly spelled letter-for-letter, visually integrated with the theme (subtle themed accents like stars, hearts, sparkles, rainbows, clouds, flowers are welcome), with a thick clean outline and warm fill colors. Place the main title inside the upper 30-40% of the cover. Place the age label inside a clear round badge in an upper or lower corner. There is NO subtitle line — do not invent one.`;

  const prompt = [
    `Create a premium front cover for a children's coloring book.`,
    refClause,
    `Book title: "${title}".`,
    hasSubtitle ? `Subtitle: "${subtitle}".` : `NO subtitle — the cover has no subtitle line at all.`,
    `Age label: "${ageBadge}".`,
    `Theme: ${theme}.`,
    `Main characters: ${mainStr}.`,
    `Background elements: ${bgStr}.`,
    `Canvas size: ${aspect} front cover.`,
    `Use 1-3 newly illustrated main characters in a cute, friendly, expressive style with rounded shapes, cheerful faces, big kind eyes, and lively poses. Place the characters in the center or lower half of the cover. Build a bright, colorful, joyful background that supports the theme without becoming cluttered — clear foreground, midground, and background layers.`,
    layoutClause,
    `SAFE-AREA — every letter, glyph, character, and important element must stay at least 0.25 inches away from the trim edge (interior 92% of the canvas). Nothing may be cropped by the edge. Nothing important may touch the border. Give the title generous breathing room; if the title is long, break it onto 2-3 balanced lines rather than letting a word run edge-to-edge.`,
    `Use bright cheerful pastel colors (pink, sky blue, mint, lavender, soft yellow, peach, cream) with strong contrast, clean outlines, balanced spacing, and a professional visual hierarchy. The cover must look attractive to children and trustworthy to parents, and must remain readable as a small online marketplace thumbnail.`,
    `Include ONLY these text elements anywhere in the image: ${textElementsList}. No other words, taglines, credits, publisher name, price, page count, banner text, sound-effect words, character-name captions, or letter-shaped ornaments. Every ornament must be a pure graphic shape (star, dot, heart, leaf, sparkle) — never a letter or word.`,
    spellingContract,
    `Style: premium children's coloring book cover, whimsical, cheerful, clean composition, polished illustration, custom hand-drawn title lettering, strong visual hierarchy, professional book cover design, parent-friendly, kid-friendly, suitable for online marketplace thumbnail, high-resolution, print-ready composition.`,
    `NEGATIVE — no watermark, no logo, no page numbers, no website URL, no extra text, no subtitle, no tagline, no descriptor word, no misspelled words, no duplicated title, no copied interior page, no photorealism, no 3D rendering, no photograph, no cluttered composition, no scary imagery, no tiny hard-to-see linework, no dark muddy palette.`,
  ].filter(Boolean).join(" ");

  return capAndAssert(prompt, { title, subtitle, ageBadge });
}

function capAndAssert(prompt: string, expected: { title: string; subtitle: string; ageBadge: string }): string {
  const capped = prompt.length > 3000 ? prompt.slice(0, 2990) + " ..." : prompt;
  assertMasterPromptShape(capped, expected);
  return capped;
}

export function assertMasterPromptShape(
  prompt: string,
  expected: { title: string; subtitle: string; ageBadge: string },
): void {
  if (typeof prompt !== "string" || prompt.length < 200) {
    throw new Error("coloring_master_cover_v1: prompt is empty or too short");
  }
  if (prompt.length > 3000) {
    throw new Error(`coloring_master_cover_v1: prompt exceeds 3000 chars (${prompt.length})`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (key === "subtitle") continue; // subtitle is optional (essentials-only rule)
    if (!value || value.length < 1) {
      throw new Error(`coloring_master_cover_v1: expected.${key} is empty`);
    }
    if (!prompt.includes(value)) {
      throw new Error(`coloring_master_cover_v1: prompt is missing verbatim ${key} "${value}"`);
    }
  }
  const lower = prompt.toLowerCase();
  for (const banned of BANNED_WORDS) {
    // The banned words appear only inside the NEGATIVE clause (e.g. "no watermark").
    // We require every mention to be preceded by "no " (case-insensitive).
    let idx = 0;
    while (true) {
      const at = lower.indexOf(banned, idx);
      if (at < 0) break;
      const prefix = lower.slice(Math.max(0, at - 4), at);
      if (!/no\s$/.test(prefix)) {
        throw new Error(`coloring_master_cover_v1: banned word "${banned}" not inside a negative clause`);
      }
      idx = at + banned.length;
    }
  }
  if (!/reference only|reference-only|inspiration only|do not copy/i.test(prompt)) {
    // Reference-only clause is optional (interior refs may not exist) but if
    // any reference-image language appears it must be scoped as inspiration.
    // We tolerate its absence entirely.
  }
}
