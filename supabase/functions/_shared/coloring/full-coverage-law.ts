// OWNER LAW `coloring_full_coverage_v1` (2026-07-25):
// If a concept advertises "A-Z", "0-9", or any exhaustive countable set, the
// book MUST have enough interior pages to cover it in full. Partial alphabets
// or partial number ranges are BANNED — they mislead the shopper and ship a
// disappointing product. Applied at concept stage AND page-plan stage.

export type CoverageKind = "alphabet" | "numbers_0_9" | "numbers_1_10" | null;

export function detectCoverageKind(text: string): CoverageKind {
  const s = (text ?? "").toLowerCase();
  if (/(alphabet|\ba[\s\-]?z\b|abc|a to z)/i.test(s)) return "alphabet";
  if (/\b0[\s\-]?9\b|numbers 0 to 9|zero to nine/i.test(s)) return "numbers_0_9";
  if (/\b1[\s\-]?10\b|numbers 1 to 10|one to ten|counting( book)?/i.test(s)) return "numbers_1_10";
  return null;
}

export function requiredCoveragePages(kind: CoverageKind): number {
  if (kind === "alphabet") return 26;
  if (kind === "numbers_0_9") return 10;
  if (kind === "numbers_1_10") return 10;
  return 0;
}

/**
 * Returns `null` if the theme+title-implied coverage fits the pageCount, or a
 * human-readable rejection reason. Coverage is scanned across theme, title,
 * subtitle, hero subjects, and parent_hook so a "Learn Your ABCs" concept
 * with 16 pages is rejected the moment it lands.
 */
export function violatesFullCoverage(
  fields: { theme?: string; title?: string; subtitle?: string; hero_subjects?: string[]; parent_hook?: string; motif_inventory?: string[] },
  pageCount: number,
): { violation: false } | { violation: true; kind: CoverageKind; required: number; got: number; reason: string } {
  const blob = [
    fields.theme ?? "",
    fields.title ?? "",
    fields.subtitle ?? "",
    (fields.hero_subjects ?? []).join(" "),
    fields.parent_hook ?? "",
    (fields.motif_inventory ?? []).join(" "),
  ].join(" ");
  const kind = detectCoverageKind(blob);
  if (!kind) return { violation: false };
  const required = requiredCoveragePages(kind);
  if (pageCount >= required) return { violation: false };
  return {
    violation: true,
    kind,
    required,
    got: pageCount,
    reason: `full_coverage_violation:${kind}:need_${required}_pages_have_${pageCount}`,
  };
}

/** Deterministic slot label for page N in a full-coverage plan. */
export function coverageSlotLabel(kind: NonNullable<CoverageKind>, pageIndex: number): string {
  if (kind === "alphabet") {
    const letter = String.fromCharCode("A".charCodeAt(0) + pageIndex);
    return `Letter ${letter}`;
  }
  if (kind === "numbers_0_9") return `Number ${pageIndex}`;
  if (kind === "numbers_1_10") return `Number ${pageIndex + 1}`;
  return `Slot ${pageIndex + 1}`;
}
