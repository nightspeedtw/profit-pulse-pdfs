import { describe, expect, it } from "vitest";
import {
  decideRepair,
  replanEscalatedPage,
  sanitizeSceneForColorability,
} from "../../supabase/functions/_shared/coloring/repair-ladder.ts";

const basePage = {
  canonical_page_number: 19,
  primary_subject: "dolphin",
  secondary_subjects: ["coral"],
  scene: "dolphin swimming through open water",
  complexity: "medium",
  required_elements: ["dolphin"],
  forbidden_elements: [],
  composition_type: "subject_in_environment",
  scene_bucket: "environment",
} as any;

describe("coloring escalate reaction", () => {
  it("attempt 4 returns escalate for open-water dolphin", () => {
    const d = decideRepair(basePage, 4, ["large solid-black area", "black_pixel_ratio"]);
    expect(d.action).toBe("escalate");
  });

  it("replanEscalatedPage produces a portrait spec with clean scene", () => {
    const r = replanEscalatedPage(basePage);
    expect(r.composition_type).toBe("single_subject_centered");
    expect(r.complexity).toBe("simple");
    expect(r.secondary_subjects).toEqual([]);
    expect(r.scene).toMatch(/portrait/);
    expect(r.scene).toMatch(/plain white background/);
    expect(r.scene.toLowerCase()).not.toMatch(/open water|swimming through/);
  });

  it("sanitizeSceneForColorability strips risky open-water phrasing", () => {
    expect(sanitizeSceneForColorability("narwhal in the sea underwater")).not.toMatch(/underwater|in the sea/i);
    expect(sanitizeSceneForColorability("dolphin swimming through open water"))
      .not.toMatch(/open water|swimming through/i);
  });

  it("solid_black_fill corrective clauses forbid water fills", () => {
    const d = decideRepair(basePage, 2, ["solid_black"]);
    const text = d.prompt_additions.join(" ").toLowerCase();
    expect(text).toMatch(/never fill water areas/);
    expect(text).toMatch(/thin outline wave lines and bubbles/);
  });
});
