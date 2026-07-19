// coloring_rulebook_v1 lane invariants (2026-07-19).
//
// The coloring lane MUST NEVER invoke narrative/story-gate/manuscript
// judges. Those are novel-lane concerns. This module provides a runtime
// assertion callable at the entry of any coloring worker to fail loud
// if a coloring row is somehow routed through a novel-lane step.

export const COLORING_RULEBOOK_VERSION = "coloring_rulebook_v1";

// Novel-lane step names that must NEVER appear on a coloring book row.
export const FORBIDDEN_NOVEL_STEPS_FOR_COLORING: readonly string[] = [
  "story_gate",
  "story_judge",
  "manuscript_write",
  "manuscript_repair",
  "narrative_gate",
  "bible_check",
  "generic_risk",
];

/**
 * Assert a row is safe to process under coloring_rulebook_v1. Called at
 * the entry of coloring workers as a lightweight guard: if some upstream
 * bug ever routes a coloring row through a novel-lane step, we throw
 * with an unambiguous error class instead of silently spending on it.
 */
export function assertColoringLaneInvariant(row: {
  id?: string;
  book_type?: string | null;
  metadata?: Record<string, unknown> | null;
}, invokedStep: string): void {
  if (row?.book_type !== "coloring_book") return; // not our lane
  if (FORBIDDEN_NOVEL_STEPS_FOR_COLORING.includes(invokedStep)) {
    throw new Error(
      `coloring_lane_invariant_violation: step='${invokedStep}' is a novel-lane gate and MUST NOT run on book_type='coloring_book' (row=${row?.id ?? "?"}). coloring_rulebook_v1 forbids narrative/story-gate judges on this lane.`,
    );
  }
}

/**
 * SCOPE GUARD (coloring_rulebook_v1_scope_guard, 2026-07-19).
 *
 * EVERY rule shipped under coloring_rulebook_v1 (rulebook, anatomy
 * deformity-only, cover interiors-as-ref, title-spelling law, de-fill,
 * waiver/learning mode, coloring pricing, age-band chips, solid-black
 * removal, garbage-image sanity floor, etc.) applies ONLY to rows with
 * `book_type === 'coloring_book'`.
 *
 * Any shared module that branches into coloring-lane behaviour MUST call
 * `assertColoringOnly(bookType, moduleName)` at the entry so a
 * picture_book/novel row hitting the same shared code path throws
 * loudly instead of silently applying coloring rules.
 */
export function assertColoringOnly(
  bookType: string | null | undefined,
  moduleName: string,
): void {
  if (bookType !== "coloring_book") {
    throw new Error(
      `coloring_rulebook_v1_scope_guard: module '${moduleName}' invoked on book_type='${bookType ?? "null"}' — coloring-lane rules must NEVER run on non-coloring rows.`,
    );
  }
}

/** Non-throwing variant for shared code paths that want to no-op on non-coloring rows. */
export function isColoringLane(bookType: string | null | undefined): boolean {
  return bookType === "coloring_book";
}

