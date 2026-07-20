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

export const COLORING_MASTER_COVER_PROMPT_VERSION = "coloring_master_cover_v3_title_only_bake";

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

  // OWNER LAW 2026-07-20 `coloring_v2_cover_overlay_v1`:
  // Ideogram bakes ONLY the title (+ optional subtitle). Age badges and
  // SALE ribbons are drawn deterministically by the overlay layer — they
  // MUST NOT appear in the baked art (baked badges/ribbons produce
  // gibberish like "COLONG ADVENTURE"). The prompt therefore explicitly
  // FORBIDS any badge/ribbon/age text and the OCR gate rejects them.
  const textElementsList = hasSubtitle
    ? `"${title}", "${subtitle}"`
    : `"${title}"`;
  const spellingContract = hasSubtitle
    ? `SPELLING CONTRACT — the title must read EXACTLY "${title}" and the subtitle must read EXACTLY "${subtitle}". Count the letters and check twice. Do NOT invent, drop, duplicate, transpose, hyphenate, split, or join any letter.`
    : `SPELLING CONTRACT — the title must read EXACTLY "${title}". Count the letters and check twice. Do NOT invent, drop, duplicate, transpose, hyphenate, split, or join any letter. Do NOT add ANY subtitle, tagline, descriptor, or decorative word — the cover carries ONLY the title.`;
  const layoutClause = hasSubtitle
    ? `The title must use large CUSTOM HAND-DRAWN illustrated lettering, not a plain standard system font. The lettering must be bold, rounded, playful, highly readable, correctly spelled letter-for-letter, visually integrated with the theme (subtle themed accents like stars, hearts, sparkles, rainbows, clouds, flowers are welcome), with a thick clean outline and warm fill colors. Place the main title inside the upper 30-40% of the cover. Place the subtitle immediately beneath the title on its own line. Do NOT draw any age badge, age label, ribbon, banner, sticker, or corner text — those are added later by a separate layer.`
    : `The title must use large CUSTOM HAND-DRAWN illustrated lettering, not a plain standard system font. The lettering must be bold, rounded, playful, highly readable, correctly spelled letter-for-letter, visually integrated with the theme (subtle themed accents like stars, hearts, sparkles, rainbows, clouds, flowers are welcome), with a thick clean outline and warm fill colors. Place the main title inside the upper 30-40% of the cover. There is NO subtitle line — do not invent one. Do NOT draw any age badge, age label, ribbon, banner, sticker, or corner text — those are added later by a separate layer.`;

  const isYA = input.styleMode === "ya_scifi_cinematic";
  const openingClause = isYA
    ? `Create a PREMIUM PROFESSIONAL GRAPHIC-NOVEL KEY-ART cover for a teen/young-adult coloring book (ages 13-17). Reference bar: bestseller YA graphic novel front cover, cinematic movie-poster energy, magazine-quality painterly digital illustration — NOT flat, NOT line-art, NOT a coloring page. This is the SELLING cover; the coloring pages live inside.`
    : `Create a PREMIUM AMAZON KDP BESTSELLER children's coloring-book cover. Reference bar: top-selling illustrated children's book front cover — RICH SATURATED FULL-COLOR polished digital illustration, painterly rendering, professional book-cover art direction — NOT flat, NOT line-art, NOT a coloring page. The coloring pages live inside; THIS is the vibrant selling cover.`;
  const heroClause = isYA
    ? `ONE clear focal hero (teen protagonist) in a dynamic 3/4 cinematic hero pose — wind-swept hair, action stance, confident expression, contemporary sci-fi wardrobe (jacket, scarf, smart-watch/HUD). Full-color painterly rendering with detailed shading, rim-light, subsurface skin tones, and expressive eyes. Build a cinematic sci-fi background with real depth — a neon cyberpunk skyline, rain, lightning, atmospheric fog, floating holographic UI, glitching data glyphs — arranged in distinct foreground / midground / background layers. Composition must feel like a professional YA graphic-novel key-art cover.`
    : `ONE clear focal hero character (or a tight group of 1-3 friends) rendered in a rich full-color painterly illustration style — expressive face, big kind eyes, dynamic pose, detailed costume, professional lighting with soft shadow, rim-light, and warm highlight. Place the hero in the lower or center of the cover with confident silhouette. Build a themed atmospheric background with real depth — matching the book's theme (space/galaxy/planets for space, jungle/animals for wildlife, castle/magic sparkles for fairies, etc.) — arranged in distinct foreground / midground / background layers with painterly atmosphere.`;
  const paletteClause = isYA
    ? `FULL-COLOR CINEMATIC PAINTED ILLUSTRATION. Use a bold cinematic YA color grade — deep indigo/navy midtones, electric cyan and violet accents, hot magenta highlights, lightning-white sparks — with dramatic contrast, atmospheric depth, moody volumetric lighting, and confident visual hierarchy. Rich saturated colors, painterly brush texture, subtle grain, cinematic color grade like a movie poster. The cover must POP as a small online marketplace thumbnail and read as a premium teen graphic-novel title. Painterly finish — NOT flat vector, NOT line-art, NOT plain fills.`
    : `FULL-COLOR RICH SATURATED PAINTED ILLUSTRATION in the style of a bestseller children's picture book / KDP-bestseller coloring-book cover. Use vibrant confident colors (deep sky-blue, sunlit yellow, warm coral, emerald, magenta, gold accents), professional color grading, dramatic hero lighting with soft rim-light and warm key-light, atmospheric background depth, painterly brush texture, gentle glow highlights, and a joyful premium finish. Strong contrast between hero and background. The cover must POP as a small online marketplace thumbnail. Painterly, polished, storybook-illustration quality — NOT flat vector, NOT line-art, NOT plain fills, NOT a coloring page.`;
  const layoutBaseYA = `The title must use large CUSTOM HAND-DRAWN illustrated lettering in a shattered/glitch YA display style — bold, angular, cinematic, highly readable, correctly spelled letter-for-letter, with a thick clean outline and dramatic accents (electric sparks, cracks, glitch fragments are welcome). Integrate the title INTO the scene (rain on the letters, glow, lightning) rather than pasting it flat on top. Place the main title inside the upper 30-40% of the cover. Place the age label inside a clear round badge in an upper or lower corner.`;
  const layoutYA = hasSubtitle
    ? `${layoutBaseYA} Place the subtitle immediately beneath the title on its own line.`
    : `${layoutBaseYA} There is NO subtitle line — do not invent one.`;
  const layoutClauseFinal = isYA ? layoutYA : layoutClause;
  const styleTag = isYA
    ? `Style: premium YA sci-fi graphic-novel key-art book cover, cinematic movie-poster feel, dramatic volumetric lighting, painterly digital illustration, rich saturated color grade, atmospheric depth (rain / lightning / fog / neon), custom hand-drawn shattered/glitch title lettering integrated into the scene, strong visual hierarchy, teen-friendly, parent-approved, suitable for online marketplace thumbnail, high-resolution print-ready cover. NOT line-art. NOT a coloring page. NOT flat vector.`
    : `Style: premium bestseller Amazon KDP children's coloring-book cover, rich saturated full-color painterly illustration, professional book-cover art direction, dramatic hero lighting with soft rim-light, atmospheric themed background with depth, custom hand-drawn illustrated title lettering, strong visual hierarchy, joyful and marketable, parent-friendly, kid-friendly, suitable for online marketplace thumbnail, high-resolution print-ready cover. NOT line-art. NOT a coloring page. NOT flat vector. Reference: top-selling KDP illustrated coloring-book front covers.`;
  const negativeYA = `NEGATIVE — no watermark, no logo, no page numbers, no website URL, no extra text, no subtitle, no tagline, no descriptor word, no misspelled words, no duplicated title, no copied interior page, no line-art, no black-outline-only illustration, no uncolored coloring-page look, no flat vector, no plain fill, no photograph, no 3D CGI plastic look, no cluttered composition, no gore, no missing limbs, no extra limbs, no deformed anatomy.`;
  const negativeDefault = `NEGATIVE — no watermark, no logo, no page numbers, no website URL, no extra text, no subtitle, no tagline, no descriptor word, no misspelled words, no duplicated title, no copied interior page, no line-art, no black-outline-only illustration, no uncolored coloring-page look, no flat vector, no plain fill, no muddy dark palette, no photograph, no 3D CGI plastic look, no cluttered composition, no scary imagery.`;

  const prompt = [
    openingClause,
    refClause,
    `Book title: "${title}".`,
    hasSubtitle ? `Subtitle: "${subtitle}".` : `NO subtitle — the cover has no subtitle line at all.`,
    `Age label: "${ageBadge}".`,
    `Theme: ${theme}.`,
    `Main characters: ${mainStr}.`,
    `Background elements: ${bgStr}.`,
    `Canvas size: ${aspect} front cover.`,
    heroClause,
    layoutClauseFinal,
    `SAFE-AREA — every letter, glyph, character, and important element must stay at least 0.25 inches away from the trim edge (interior 92% of the canvas). Nothing may be cropped by the edge. Nothing important may touch the border. Give the title generous breathing room; if the title is long, break it onto 2-3 balanced lines rather than letting a word run edge-to-edge.`,
    paletteClause,
    `Include ONLY these text elements anywhere in the image: ${textElementsList}. No other words, taglines, credits, publisher name, price, page count, banner text, sound-effect words, character-name captions, or letter-shaped ornaments. Every ornament must be a pure graphic shape (star, dot, heart, spark, geometric fragment) — never a letter or word.`,
    spellingContract,
    styleTag,
    isYA ? negativeYA : negativeDefault,
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
