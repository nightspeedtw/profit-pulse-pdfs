import { describe, it, expect } from "vitest";
import {
  normalizeDefect,
  computeFirstPassYield,
  indexRulesBySpecies,
  pickLearnedRulesFor,
  learnedClauseFromRules,
  type LearnedRule,
} from "../../supabase/functions/_shared/coloring/first-pass-learner.ts";
import { buildInteriorPrompt, DEFAULT_KIDS_4_6_STYLE } from "../../supabase/functions/_shared/coloring/style-contract.ts";

const rule = (over: Partial<LearnedRule>): LearnedRule => ({
  pattern_key: "x", species_key: "x", gate: "anatomy",
  positive_clause: "P", negative_clause: "N", composition_hint: "H",
  status: "active", version: 1, ...over,
});

describe("FIRST_PASS_YIELD_LEARNER — defect normalization", () => {
  it("classifies vertical fluke defect as cetacean_horizontal_flukes for cetaceans", () => {
    const h = normalizeDefect("tail drawn as vertical fish tail like a mermaid fin", "dolphin", "anatomy", "dolphin leaping");
    expect(h?.pattern_key).toBe("cetacean_horizontal_flukes");
    expect(h?.species_key).toBe("dolphin");
  });
  it("classifies narwhal unicorn-horn defect", () => {
    const h = normalizeDefect("tusk drawn as unicorn horn on forehead", "narwhal", "anatomy");
    expect(h?.pattern_key).toBe("narwhal_tusk_spec");
  });
  it("classifies seal 3-flipper defect", () => {
    const h = normalizeDefect("seal shown with three flippers on one side", "seal", "anatomy");
    expect(h?.pattern_key).toBe("seal_two_front_flippers");
  });
  it("classifies ray face-up defect only for rays", () => {
    expect(normalizeDefect("ray face-up view", "stingray", "anatomy")?.pattern_key).toBe("ray_dorsal_view");
    expect(normalizeDefect("ray face-up view", "dolphin", "anatomy")?.pattern_key).not.toBe("ray_dorsal_view");
  });
  it("classifies solid-black water fill in sea scenes as sea_water_outline_only", () => {
    const h = normalizeDefect("solid-black water mass over the reef", "whale", "solid_black", "underwater reef scene");
    expect(h?.pattern_key).toBe("sea_water_outline_only");
    expect(h?.species_key).toBe("__sea_scene__");
  });
  it("drops technical/verifier noise", () => {
    expect(normalizeDefect("anatomy_verifier_degraded no_verdict", "dolphin", "anatomy")).toBeNull();
    expect(normalizeDefect("provider_billing_locked", "dolphin", "anatomy")).toBeNull();
    expect(normalizeDefect("http_429 timeout retry", "dolphin", "anatomy")).toBeNull();
  });
});

describe("FIRST_PASS_YIELD_LEARNER — FPY math", () => {
  it("returns 1.0 when zero real gate rejections", () => {
    const r = computeFirstPassYield(4, [
      { page: 1, error: "anatomy_verifier_degraded", verifier_state: true } as any,
    ]);
    expect(r.fpy).toBe(1);
    expect(r.gate_rejections).toBe(0);
  });
  it("counts a page as rejected only once regardless of retries", () => {
    const r = computeFirstPassYield(4, [
      { page: 2, error: "anatomy_gate: vertical flukes" },
      { page: 2, error: "anatomy_gate: vertical flukes" },
      { page: 3, error: "solid_black:water_mass" },
    ]);
    expect(r.first_pass_pages).toBe(2);
    expect(r.fpy).toBe(0.5);
    expect(r.rejections_by_class.anatomy).toBe(2);
    expect(r.rejections_by_class.solid_black).toBe(1);
    expect(r.rejected_pages).toEqual([2, 3]);
  });
});

describe("FIRST_PASS_YIELD_LEARNER — prompt injection", () => {
  it("pickLearnedRulesFor selects species-specific + sea-scene rules", () => {
    const idx = indexRulesBySpecies([
      rule({ pattern_key: "cetacean_horizontal_flukes", species_key: "narwhal" }),
      rule({ pattern_key: "sea_water_outline_only", species_key: "__sea_scene__", gate: "solid_black" }),
      rule({ pattern_key: "seal_two_front_flippers", species_key: "seal" }),
    ]);
    const picked = pickLearnedRulesFor(idx, "narwhal", "underwater arctic scene");
    const keys = picked.map((r) => r.pattern_key).sort();
    expect(keys).toEqual(["cetacean_horizontal_flukes", "sea_water_outline_only"]);
  });

  it("learned clause lands in the base prompt for that species", () => {
    const idx = indexRulesBySpecies([
      rule({ pattern_key: "narwhal_tusk_spec", species_key: "narwhal",
             positive_clause: "SPIRAL_TUSK_FROM_UPPER_LIP",
             negative_clause: "NOT_FOREHEAD_HORN" }),
    ]);
    const picked = pickLearnedRulesFor(idx, "narwhal", "arctic ocean");
    const clause = learnedClauseFromRules(picked);
    const prompt = buildInteriorPrompt(
      { canonical_page_number: 1, primary_subject: "narwhal", secondary_subjects: [], scene: "arctic ocean" } as any,
      DEFAULT_KIDS_4_6_STYLE,
      { category_name: "Sea Animals", target_age_min: 4, target_age_max: 6 },
      { learned_prevention_clause: clause },
    );
    expect(prompt).toContain("SPIRAL_TUSK_FROM_UPPER_LIP");
    expect(prompt).toContain("NOT_FOREHEAD_HORN");
    expect(prompt).toContain("Learned prevention rules");
  });

  it("omits the learned block entirely when no rules apply", () => {
    const idx = indexRulesBySpecies([]);
    const clause = learnedClauseFromRules(pickLearnedRulesFor(idx, "dolphin", "reef"));
    expect(clause).toBe("");
    const prompt = buildInteriorPrompt(
      { canonical_page_number: 1, primary_subject: "dolphin", secondary_subjects: [], scene: "reef" } as any,
      DEFAULT_KIDS_4_6_STYLE,
      { category_name: "Sea", target_age_min: 4, target_age_max: 6 },
      { learned_prevention_clause: clause },
    );
    expect(prompt).not.toContain("Learned prevention rules");
  });
});
