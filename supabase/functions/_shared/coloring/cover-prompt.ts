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
  /**
   * Category-level forbidden subjects (e.g. Farm & Woodland must exclude
   * exotic species like tigers, lions, elephants, dolphins). Surfaced as
   * an explicit negative clause so the image model doesn't wander into
   * off-category creatures and get rejected by the hero-verification gate.
   */
  forbiddenSubjects?: string[];
  extraClauses?: (string | undefined | null)[];
  /**
   * The book title. NEVER injected into the prompt. Accepted only so the
   * assertion helper below can prove absence.
   */
  bannedTitle: string;
  /**
   * Optional per-band cover art-direction pack. When present, the profile's
   * `art_style_language`, `cover_art_direction`, and `cover_forbidden_language`
   * are injected so covers match the reader age (toddler board-book vs
   * tween graphic novel vs teen adult-adjacent).
   */
  bandProfile?: {
    label: string;
    art_style_language: string;
    cover_art_direction: string;
    cover_forbidden_language: string;
  } | null;
}

export function buildColoringCoverArtPrompt(input: CoveringCoverPromptInput): string {
  const { categoryName, ageMin, ageMax, heroSubjects, extraClauses = [], forbiddenSubjects = [], bandProfile } = input;
  const forbiddenList = forbiddenSubjects
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .slice(0, 12);
  const forbiddenClause = forbiddenList.length > 0
    ? `STRICT CATEGORY FIT for "${categoryName}": every visible creature must belong to this category. Do NOT include any of these off-category subjects: ${forbiddenList.join(", ")}. If unsure, choose one of the allowed subjects listed above.`
    : null;
  const bandStyleClause = bandProfile
    ? `AGE-BAND ART STYLE (${bandProfile.label}): ${bandProfile.art_style_language}.`
    : null;
  const bandDirectionClause = bandProfile
    ? `COVER ART DIRECTION: ${bandProfile.cover_art_direction}`
    : null;
  const bandForbiddenClause = bandProfile
    ? `AGE-BAND FORBIDDEN ON COVER: ${bandProfile.cover_forbidden_language}`
    : null;
  const clauses = [
    `Full-color cheerful children's coloring-book COVER BACKGROUND ART ONLY for "${categoryName}" ages ${ageMin}-${ageMax}.`,
    bandStyleClause,
    bandDirectionClause,
    `Show 3-5 cute friendly subjects drawn ONLY from this on-category set: ${heroSubjects.slice(0, 8).join(", ")}.`,
    `Rich colorful painterly storefront cover scene; NOT line art, NOT black-and-white, NOT an interior page. Leave clean upper-half space for later SVG title overlay.`,
    forbiddenClause,
    bandForbiddenClause,
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
