// _shared/coloring/cover-prompt.ts
//
// OWNER LAW — 'coloring_cover_textless_forever':
// The coloring cover pipeline has exactly ONE typography source forever:
// the app overlay (renderKidsTitleTreatment + age badge + logo). No model
// is ever asked to render the title, subtitle, age badge, or any other
// words on a coloring cover.
//
// Structural enforcement lives here:
//   * `buildColoringCoverArtPrompt` builds the raw-art prompt. It MUST
//     include TEXTLESS_DIRECTIVE and MUST NOT include the book's title
//     string (which would leak typography guidance to the model).
//   * `assertColoringCoverPromptIsTextless` throws when either rule fails;
//     the cover function calls it before dispatching the image generation
//     so a regression can never ship a titled prompt.
//   * The raw-art transcription gate in coloring-book-cover rejects any
//     detected glyphs pre-composite (defense in depth).
//
// This module is coloring-lane ONLY. The picture-book cover ladder keeps
// its own titled/ideogram path.

// @ts-nocheck
import { TEXTLESS_DIRECTIVE } from "../textless-illustration-policy.ts";

export const COLORING_COVER_PROMPT_VERSION = "coloring_cover_textless_v1";

export interface CoveringCoverPromptInput {
  categoryName: string;
  ageMin: number;
  ageMax: number;
  heroSubjects: string[];
  extraClauses?: (string | undefined | null)[];
  /**
   * The book title. NEVER injected into the prompt. Accepted only so the
   * assertion helper below can prove absence.
   */
  bannedTitle: string;
}

export function buildColoringCoverArtPrompt(input: CoveringCoverPromptInput): string {
  const { categoryName, ageMin, ageMax, heroSubjects, extraClauses = [] } = input;
  const clauses = [
    `Full-color cheerful children's coloring-book COVER BACKGROUND ART ONLY for "${categoryName}" ages ${ageMin}-${ageMax}.`,
    `Show 3-5 cute friendly subjects from this set: ${heroSubjects.slice(0, 8).join(", ")}.`,
    `Rich colorful painterly storefront cover scene; NOT line art, NOT black-and-white, NOT an interior page. Leave clean upper-half space for later SVG title overlay.`,
    ...extraClauses.filter((c): c is string => typeof c === "string" && c.length > 0),
    TEXTLESS_DIRECTIVE,
    `No title/subtitle/age badge, no letters/numbers/watermark/logo/signage/mockup/UI, no blank canvas, no grayscale, no solid black water.`,
  ];
  const prompt = clauses.filter(Boolean).join(" ");
  assertColoringCoverPromptIsTextless(prompt, input.bannedTitle);
  return prompt;
}

/**
 * Structural guard. Throws if either owner-law invariant is violated.
 * Called from the prompt builder AND directly from tests.
 */
export function assertColoringCoverPromptIsTextless(prompt: string, bannedTitle: string): void {
  if (!prompt.includes(TEXTLESS_DIRECTIVE)) {
    throw new Error(
      "coloring_cover_textless_forever: prompt is missing TEXTLESS_DIRECTIVE — this is an owner-law violation.",
    );
  }
  const cleaned = (bannedTitle ?? "").trim();
  if (cleaned.length >= 4 && prompt.toLowerCase().includes(cleaned.toLowerCase())) {
    throw new Error(
      `coloring_cover_textless_forever: prompt leaks the book title ("${cleaned}") to the image model — the app overlay is the only typography source.`,
    );
  }
}
