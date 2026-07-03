// Canonical manuscript hash — used to prove that a downstream artefact
// (reader-experience-qc, final PDF QC) was scored against the SAME chapter
// content currently on disk. If the hash mismatches, the score is STALE and
// must be recomputed before it can be trusted as a canonical content score.
//
// Deliberately cheap: sorts by chapter_index, hashes title + full content
// length + first 800 chars of content per chapter. Enough to detect any
// meaningful rewrite (autofix pass, humanize pass, chapter regeneration)
// while staying stable across cosmetic whitespace changes.

export interface HashableChapter {
  chapter_index?: number | null;
  index?: number | null;
  title?: string | null;
  content?: string | null;
  body?: string | null;
}

function norm(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export async function computeManuscriptHash(chapters: HashableChapter[]): Promise<string> {
  const parts = (chapters ?? [])
    .map((c, i) => {
      const idx = Number(c.chapter_index ?? c.index ?? i + 1);
      const title = norm(String(c.title ?? ""));
      const body = String(c.content ?? c.body ?? "");
      return `${idx}\u241E${title}\u241E${body.length}\u241E${norm(body).slice(0, 800)}`;
    })
    .sort()
    .join("\u241D");
  const bytes = new TextEncoder().encode(parts);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
