// Guardrail: detect BIBLE_STORY_MISMATCH.
//
// Root cause we are defending against: kids-full-repair Phase 2 used to hardcode
// hero name "Luna" (bear cub) in the bible-lock prompt, and generateCover reuses
// an existing bible without validating it matches the current manuscript. That
// combination made Sock Sorter (hero: Tali) inherit a Luna/bear bible from a
// prior book, then spend image cost generating a wrong-character cover + 12
// interiors. This validator runs BEFORE any art step to catch that.
//
// Behaviour: extract the story hero from the manuscript + title, compare against
// the bible's character.name. If the bible name is not present in the manuscript
// (and manuscript clearly names a different hero), report a mismatch. Caller is
// responsible for deciding whether to wipe the bible or hard-fail.

export const BIBLE_STORY_MISMATCH = "BIBLE_STORY_MISMATCH";

const STOPWORDS = new Set([
  "The", "A", "An", "And", "Or", "But", "In", "On", "At", "To", "From", "With",
  "One", "Two", "Little", "Big", "Great", "New", "Old", "Story", "Book", "Tale",
  "Adventure", "Chapter", "Suddenly", "Then", "Once", "There", "Here", "Ta",
  "Clink", "Clank", "Ugh", "Oh", "Ah", "Ha", "Ok", "Okay", "Yes", "No",
]);

/**
 * Extract candidate proper-noun character names from a manuscript.
 * Heuristic: capitalized single-word tokens appearing 2+ times that are not
 * stopwords, sorted by frequency.
 */
export function extractManuscriptCharacterNames(manuscript: string): string[] {
  if (!manuscript) return [];
  const tokens = manuscript.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

export interface MismatchReport {
  mismatch: boolean;
  reason: string;
  bibleName: string | null;
  manuscriptCandidates: string[];
  storyHero: string | null;
}

/**
 * Compare bible character.name against manuscript. Returns mismatch=true when
 * the bible clearly locks a different hero than the story stars.
 */
export function detectBibleStoryMismatch(input: {
  manuscript: string;
  title?: string | null;
  storyBible?: Record<string, unknown> | null;
  characterBible?: Record<string, unknown> | null;
}): MismatchReport {
  const candidates = extractManuscriptCharacterNames(input.manuscript ?? "");
  const bibleName = (input.characterBible?.name as string | undefined)?.trim() || null;
  const storyHero =
    ((input.storyBible?.hero as string | undefined) ?? "")
      .split(/[,\s—-]/)[0]
      ?.trim() ||
    candidates[0] ||
    null;

  if (!bibleName) {
    return {
      mismatch: false,
      reason: "no bible name yet",
      bibleName,
      manuscriptCandidates: candidates,
      storyHero,
    };
  }
  if (candidates.length === 0) {
    // Cannot verify — do not block.
    return {
      mismatch: false,
      reason: "manuscript has no repeated proper-noun hero to compare",
      bibleName,
      manuscriptCandidates: candidates,
      storyHero,
    };
  }
  const bibleInStory =
    new RegExp(`\\b${escapeRegex(bibleName)}\\b`, "i").test(input.manuscript);
  if (bibleInStory) {
    return {
      mismatch: false,
      reason: "bible name appears in manuscript",
      bibleName,
      manuscriptCandidates: candidates,
      storyHero,
    };
  }
  return {
    mismatch: true,
    reason: `bible locks "${bibleName}" but manuscript stars "${
      storyHero ?? candidates[0]
    }" (bible name never appears in story text)`,
    bibleName,
    manuscriptCandidates: candidates,
    storyHero,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
