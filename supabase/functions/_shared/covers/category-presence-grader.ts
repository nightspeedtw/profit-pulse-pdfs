// Category presence + prominence grader for coloring covers.
//
// AMENDMENT to coloring_rulebook_v1 (2026-07-19, owner clarification):
// human CHILDREN are welcome on coloring covers as appeal companions.
// The cover-hero check grades PRESENCE and DOMINANCE of category
// subjects, not exclusion of humans.
//
//   PASS: cover shows plenty of category subjects (with or without a
//         child alongside them).
//   FAIL: only when category subjects are missing or reduced to
//         background garnish (child-only on a sea-animals book fails;
//         child + prominent sea animals passes).
//
// This module is a PURE function so it is unit-testable under Node/
// Vitest without pulling any Deno-only imports.

export type Prominence = "foreground" | "midground" | "background" | "absent";

export interface DetectedSubject {
  /** Concrete noun phrase for the thing seen, e.g. "orange clownfish". */
  name: string;
  /** Where in the composition the subject sits. */
  prominence: Prominence;
  /** true iff this detection is a human child (any age up to ~12) or baby. */
  is_human_child?: boolean;
  /**
   * true iff `name` is semantically covered by the category's
   * `allowed_subjects` list. The vision model tags this per-subject so
   * the grader does not need to re-run string matching.
   */
  category_match?: boolean;
}

export interface CategoryPresenceInput {
  detected: DetectedSubject[];
  /** Category display name, e.g. "Sea Animals". Used for reason strings. */
  category_name: string;
}

export interface CategoryPresenceVerdict {
  ok: boolean;
  /** foreground|midground count of category subjects (humans excluded). */
  prominent_category_count: number;
  /** foreground-only count of category subjects. */
  foreground_category_count: number;
  /** count of category subjects anywhere (fg+mg+bg). */
  total_category_count: number;
  /** true iff at least one human child was detected (neutral). */
  child_present: boolean;
  reason: string;
}

/**
 * PASS rule (owner-approved):
 *   at least ONE category subject is truly foregrounded (hero-level),
 *   AND the total prominent (foreground+midground) count of category
 *   subjects is at least TWO.
 *
 * A lone big hero (e.g. one giant whale filling the page) also passes
 * because we accept `foreground_category_count >= 2` as an alternate
 * satisfaction — this keeps "many creatures" spirit while allowing a
 * classic single-hero composition when the hero itself is duplicated
 * in the frame (school of fish, herd) or accompanied by any
 * midground category subject.
 *
 * Humans (child_present) are NEVER a defect on their own; they simply
 * don't count toward the category quota.
 */
export function gradeCategoryPresence(input: CategoryPresenceInput): CategoryPresenceVerdict {
  const items = Array.isArray(input.detected) ? input.detected : [];
  const catItems = items.filter((d) => d && d.category_match === true && !d.is_human_child);
  const fg = catItems.filter((d) => d.prominence === "foreground").length;
  const mg = catItems.filter((d) => d.prominence === "midground").length;
  const total = catItems.length;
  const prominent = fg + mg;
  const child_present = items.some((d) => d && d.is_human_child === true);

  const pass = (fg >= 1 && prominent >= 2) || fg >= 2;
  const reason = pass
    ? `category_present:fg=${fg};mg=${mg};total=${total}${child_present ? ";child_companion=ok" : ""}`
    : total === 0
      ? `no_category_subjects:${input.category_name}${child_present ? ";only_child_present" : ""}`
      : `category_only_background:fg=${fg};mg=${mg};total=${total}${child_present ? ";child_dominant" : ""}`;
  return {
    ok: pass,
    prominent_category_count: prominent,
    foreground_category_count: fg,
    total_category_count: total,
    child_present,
    reason,
  };
}
