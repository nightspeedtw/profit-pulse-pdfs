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
export const METADATA_STORY_MISMATCH = "METADATA_STORY_MISMATCH";

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

/**
 * Extract dominant premise "terms" from a manuscript — non-stopword tokens
 * appearing 2+ times, lowercased. Used to compare against title/description.
 */
export function extractManuscriptTerms(manuscript: string, minCount = 2): string[] {
  if (!manuscript) return [];
  const tokens = manuscript.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) ?? [];
  const stop = new Set([
    "the","and","was","were","with","from","this","that","have","said","just",
    "then","some","when","what","your","them","they","into","their","been",
    "here","there","little","would","could","should","about","which","like",
    "over","onto","upon","also","very","really","because","around","again",
    "still","after","before","every","many","much","more","most","only","even",
    "such","other","another","across","along","among","between","without",
    "into","under","above","below","being","doing","going","having","made",
    "make","make","tali","said",
  ]);
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (stop.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 40);
}

export interface MetadataMismatchReport {
  mismatch: boolean;
  reason: string;
  manuscript_hero: string | null;
  metadata_hero: string | null;
  manuscript_terms: string[];
  stale_metadata_terms: string[];
  repair_action: "auto_sync" | "hard_block" | "none";
}

/**
 * Compare storefront title/description/storefront_meta against the manuscript.
 * If metadata references a hero name not present in the manuscript, or none of
 * the top manuscript terms appear in the title+description, flag mismatch.
 * `repair_action=auto_sync` means the caller can safely regenerate metadata
 * from the manuscript (manuscript is trusted). `hard_block` means metadata
 * evidence is contradictory AND no clear manuscript hero exists to sync from.
 */
export function detectMetadataStoryMismatch(input: {
  manuscript: string;
  title?: string | null;
  description?: string | null;
  storefrontMeta?: Record<string, unknown> | null;
}): MetadataMismatchReport {
  const manuscript = input.manuscript ?? "";
  const candidates = extractManuscriptCharacterNames(manuscript);
  const manuscriptHero = candidates[0] ?? null;
  const title = String(input.title ?? "");
  const description = String(input.description ?? "");
  const metaBlob = `${title} ${description}`.trim();
  const metaHeroCandidates = extractManuscriptCharacterNames(metaBlob + "\n" + metaBlob);
  const metadataHero = metaHeroCandidates[0] ?? null;

  const manuscriptTerms = extractManuscriptTerms(manuscript);
  const metaLower = metaBlob.toLowerCase();
  const staleTerms: string[] = [];
  // Terms that appear in metadata but never in the manuscript.
  for (const t of extractManuscriptTerms(metaBlob, 1)) {
    if (t.length < 4) continue;
    if (!new RegExp(`\\b${escapeRegex(t)}\\b`).test(manuscript.toLowerCase())) {
      staleTerms.push(t);
    }
  }
  // Metadata hero must appear in manuscript.
  const heroInManuscript = metadataHero
    ? new RegExp(`\\b${escapeRegex(metadataHero)}\\b`, "i").test(manuscript)
    : true;
  // Top manuscript terms must appear in metadata (at least 1 of top 5).
  const topInMeta = manuscriptTerms.slice(0, 5).some((t) =>
    new RegExp(`\\b${escapeRegex(t)}\\b`).test(metaLower)
  );

  if (heroInManuscript && topInMeta) {
    return {
      mismatch: false, reason: "metadata aligns with manuscript",
      manuscript_hero: manuscriptHero, metadata_hero: metadataHero,
      manuscript_terms: manuscriptTerms, stale_metadata_terms: staleTerms,
      repair_action: "none",
    };
  }
  const canAutoSync = !!manuscriptHero && manuscriptTerms.length >= 3;
  return {
    mismatch: true,
    reason: !heroInManuscript
      ? `metadata hero "${metadataHero}" is not present in manuscript (manuscript hero: "${manuscriptHero}")`
      : `no top manuscript terms appear in metadata; likely stale storefront copy`,
    manuscript_hero: manuscriptHero,
    metadata_hero: metadataHero,
    manuscript_terms: manuscriptTerms,
    stale_metadata_terms: staleTerms,
    repair_action: canAutoSync ? "auto_sync" : "hard_block",
  };
}
