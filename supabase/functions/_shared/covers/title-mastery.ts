// COVER TITLE MASTERY — 2026 industry-consensus techniques for reliable
// text-in-image generation, encoded once and reused by every cover path.
//
// See pipeline_skills.cover_title_mastery for the human-readable playbook.
// This module is the executable half: planning stacked lines, building
// prompts that steer text models toward literal spelling, and verifying
// results with fuzzy (Levenshtein) matching that survives 1–2 glyph
// artifacts without letting real misspellings through.

/** Plan a stacked-line layout so no rendered line exceeds ~14 chars. */
export function planTitleLines(title: string, maxPerLine = 14): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + " " + w).length <= maxPerLine) cur = cur + " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // If any single word exceeds maxPerLine, leave it (models handle long
  // words fine; splitting mid-word invites hyphenation artifacts).
  return lines;
}

/** Letter-by-letter spelling of failure-prone words (apostrophes, invented). */
export function spellOutTrickyWords(title: string): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const tricky: string[] = [];
  for (const w of words) {
    const stripped = w.replace(/[^A-Za-z'’-]/g, "");
    const isInvented = /[A-Z][a-z]*[A-Z]/.test(stripped) // CamelCase
      || /-/.test(stripped)                              // hyphenated
      || /['’]/.test(stripped)                           // apostrophes
      || (stripped.length >= 8 && !/(ing|tion|ness|ment|able)$/i.test(stripped));
    if (isInvented) {
      const letters = stripped
        .replace(/['’]/g, "-apostrophe-")
        .replace(/-/g, "-hyphen-")
        .split("")
        .filter((c) => c !== "")
        .join("-");
      tricky.push(`${w} spelled ${letters}`);
    }
  }
  return tricky;
}

/** Normalize a title for comparison: casefold, strip ALL punctuation, whitespace. */
export function normalizeForCompare(s: string): string {
  return (s || "")
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Levenshtein distance between two strings (small strings only — O(n*m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Levenshtein-similarity (1 - dist/maxLen). 1.0 = identical. */
export function similarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

/** Threshold: ≥0.93 allows 1-2 glyph artifacts on long titles, catches typos. */
export const TITLE_SIMILARITY_THRESHOLD = 0.93;

export function verifyTitleFuzzy(
  expected: string,
  transcribed: string,
  threshold = TITLE_SIMILARITY_THRESHOLD,
): { pass: boolean; similarity: number; expected: string; transcribed: string; normalized: { exp: string; got: string }; threshold: number } {
  const sim = similarity(expected, transcribed);
  return {
    pass: sim >= threshold,
    similarity: Number(sim.toFixed(4)),
    expected,
    transcribed,
    normalized: { exp: normalizeForCompare(expected), got: normalizeForCompare(transcribed) },
    threshold,
  };
}

/**
 * Build the text-mastery prompt fragment for a title.
 * Encodes the four techniques: exact quoted title, stacked short lines,
 * generic style description, letter-by-letter spelling for tricky words.
 */
export function buildTitlePromptFragment(opts: {
  title: string;
  subtitle?: string | null;
  emphasizeStack?: boolean;
}): string {
  const lines = planTitleLines(opts.title);
  const tricky = spellOutTrickyWords(opts.title);
  const stackPlan = lines.length > 1
    ? `The title MUST be laid out as ${lines.length} stacked lines (each ≤14 characters), in this exact order and line-break plan: ${lines.map((l, i) => `line ${i + 1} = "${l}"`).join(", ")}.`
    : `The title fits on ONE line.`;
  return [
    `TITLE TEXT (must be rendered LITERALLY, character-for-character): "${opts.title}"`,
    opts.subtitle ? `SUBTITLE: "${opts.subtitle}"` : "",
    stackPlan,
    tricky.length ? `Spelling anchors (render exactly these letters, do NOT auto-correct or invent variants): ${tricky.join(" · ")}.` : "",
    `Style: chunky rounded hand-painted children's-book letters with a thick dark outline and soft drop shadow, warm palette, slight bouncing baseline, positioned in the upper third with clear readability armor at 100×160px thumbnail size.`,
    `Prefer STRAIGHT single-quote apostrophes (') over curly (' ’). Do NOT draw any other text on the cover — no author line, no publisher mark, no in-scene labels, no signage, no speech bubbles.`,
  ].filter(Boolean).join(" ");
}
