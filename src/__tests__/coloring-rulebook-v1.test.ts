import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// coloring_rulebook_v1 (2026-07-19) regression:
// The coloring lane must have its OWN simple rulebook. Novel-lane
// judges (story_gate, manuscript_write, bible_check, narrative_gate,
// generic_risk) MUST NEVER be referenced or invoked from any coloring
// worker source file. Prevents the class of leak the owner observed
// ("coloring books retired with band_theme_mismatch and Publish blocked
// (spelling)" — novel-style gates).

const COLORING_FN_DIRS = [
  "supabase/functions/coloring-book-start",
  "supabase/functions/coloring-book-cover",
  "supabase/functions/coloring-book-render",
  "supabase/functions/coloring-book-assemble",
  "supabase/functions/coloring-book-publish",
  "supabase/functions/coloring-book-thumbnail",
  "supabase/functions/coloring-worker-tick",
  "supabase/functions/coloring-autopilot-tick",
  "supabase/functions/coloring-cover-generate",
  "supabase/functions/coloring-cover-verify",
  "supabase/functions/coloring-cover-refit",
  "supabase/functions/coloring-cover-upgrade-sweep",
  "supabase/functions/coloring-marketing-thumbnail",
  "supabase/functions/_shared/coloring",
];

// Novel-lane function/step names that must not appear as CALLS from the
// coloring lane. We allow the string to appear in comments/docs (many
// existing comments explicitly say "coloring lane never invokes X") so
// we check for actual invocation patterns.
const FORBIDDEN_INVOCATION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "invoke story_gate function", re: /functions\/v1\/kids-repair-story-gate/ },
  { label: "invoke narrative judge", re: /functions\/v1\/kids-story-judge/ },
  { label: "invoke surgical story repair", re: /functions\/v1\/kids-surgical-story-repair/ },
  { label: "invoke supervisor from coloring", re: /functions\/v1\/kids-repair-supervisor/ },
  { label: "invoke autopilot-kids-pipeline", re: /functions\/v1\/autopilot-kids-pipeline/ },
  { label: "call storyGate(", re: /\bstoryGate\s*\(/ },
  { label: "call judgeNarrative(", re: /\bjudgeNarrative\s*\(/ },
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("coloring_rulebook_v1 lane invariants", () => {
  it("coloring lane source files must never invoke novel-lane judges", () => {
    const files = COLORING_FN_DIRS.flatMap(walkTs);
    expect(files.length).toBeGreaterThan(5);
    const violations: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const { label, re } of FORBIDDEN_INVOCATION_PATTERNS) {
        if (re.test(src)) violations.push(`${f} :: ${label}`);
      }
    }
    expect(violations, `coloring lane must not call novel-lane judges:\n${violations.join("\n")}`).toEqual([]);
  });

  it("assertColoringLaneInvariant throws for forbidden novel steps", async () => {
    const mod = await import("../../supabase/functions/_shared/coloring/lane-invariants.ts");
    const row = { id: "abc", book_type: "coloring_book" as const };
    for (const step of mod.FORBIDDEN_NOVEL_STEPS_FOR_COLORING) {
      expect(() => mod.assertColoringLaneInvariant(row, step))
        .toThrow(/coloring_lane_invariant_violation/);
    }
    // Non-coloring rows are ignored.
    expect(() => mod.assertColoringLaneInvariant({ book_type: "picture_book" }, "story_gate")).not.toThrow();
    // Legitimate coloring step passes.
    expect(() => mod.assertColoringLaneInvariant(row, "coloring_cover_ideogram")).not.toThrow();
  });
});
