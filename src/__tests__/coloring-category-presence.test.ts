// Amendment to coloring_rulebook_v1 (2026-07-19): humans are neutral;
// grade PRESENCE + DOMINANCE of category subjects.
//
//   child + prominent sea animals  → PASS
//   child-only on a Sea Animals    → FAIL
//   animals-only                   → PASS
//
// Also: forbidden_hit alone never fails; missing category subjects do.

import { describe, expect, it } from "vitest";
import {
  gradeCategoryPresence,
  type DetectedSubject,
} from "../../supabase/functions/_shared/covers/category-presence-grader.ts";

const SEA = "Sea Animals";

describe("coloring_rulebook_v1 amendment — category presence + prominence", () => {
  it("child + prominent sea animals PASSES", () => {
    const detected: DetectedSubject[] = [
      { name: "smiling human girl", prominence: "foreground", is_human_child: true, category_match: false },
      { name: "orange clownfish", prominence: "foreground", category_match: true },
      { name: "green sea turtle", prominence: "midground", category_match: true },
      { name: "school of tiny fish", prominence: "midground", category_match: true },
    ];
    const v = gradeCategoryPresence({ detected, category_name: SEA });
    expect(v.ok).toBe(true);
    expect(v.child_present).toBe(true);
    expect(v.foreground_category_count).toBe(1);
    expect(v.prominent_category_count).toBe(3);
    expect(v.reason).toMatch(/category_present/);
    expect(v.reason).toMatch(/child_companion=ok/);
  });

  it("child-only cover on a Sea Animals book FAILS", () => {
    const detected: DetectedSubject[] = [
      { name: "human boy holding a bucket", prominence: "foreground", is_human_child: true, category_match: false },
      { name: "beach sand", prominence: "background", category_match: false },
    ];
    const v = gradeCategoryPresence({ detected, category_name: SEA });
    expect(v.ok).toBe(false);
    expect(v.child_present).toBe(true);
    expect(v.foreground_category_count).toBe(0);
    expect(v.total_category_count).toBe(0);
    expect(v.reason).toMatch(/no_category_subjects/);
    expect(v.reason).toMatch(/only_child_present/);
  });

  it("animals-only cover PASSES", () => {
    const detected: DetectedSubject[] = [
      { name: "humpback whale", prominence: "foreground", category_match: true },
      { name: "spotted dolphin", prominence: "foreground", category_match: true },
      { name: "coral reef", prominence: "midground", category_match: true },
    ];
    const v = gradeCategoryPresence({ detected, category_name: SEA });
    expect(v.ok).toBe(true);
    expect(v.child_present).toBe(false);
    expect(v.foreground_category_count).toBe(2);
    expect(v.reason).toMatch(/category_present/);
    expect(v.reason).not.toMatch(/child_companion/);
  });

  it("category subjects only in the background FAILS (garnish rule)", () => {
    const detected: DetectedSubject[] = [
      { name: "human girl with pail", prominence: "foreground", is_human_child: true, category_match: false },
      { name: "tiny distant fish", prominence: "background", category_match: true },
      { name: "seagull silhouette", prominence: "background", category_match: true },
    ];
    const v = gradeCategoryPresence({ detected, category_name: SEA });
    expect(v.ok).toBe(false);
    expect(v.foreground_category_count).toBe(0);
    expect(v.prominent_category_count).toBe(0);
    expect(v.total_category_count).toBe(2);
    expect(v.reason).toMatch(/category_only_background/);
  });

  it("single big foregrounded hero + one midground companion PASSES", () => {
    // e.g. one giant octopus foregrounded + a starfish midground
    const detected: DetectedSubject[] = [
      { name: "giant octopus", prominence: "foreground", category_match: true },
      { name: "starfish", prominence: "midground", category_match: true },
    ];
    const v = gradeCategoryPresence({ detected, category_name: SEA });
    expect(v.ok).toBe(true);
  });

  it("humans are neutral — never a defect on their own when category subjects are prominent", () => {
    const detected: DetectedSubject[] = [
      { name: "human toddler", prominence: "foreground", is_human_child: true, category_match: false },
      { name: "human mom", prominence: "midground", is_human_child: false, category_match: false },
      { name: "dolphin", prominence: "foreground", category_match: true },
      { name: "sea turtle", prominence: "foreground", category_match: true },
    ];
    const v = gradeCategoryPresence({ detected, category_name: SEA });
    expect(v.ok).toBe(true);
    expect(v.foreground_category_count).toBe(2);
  });
});
