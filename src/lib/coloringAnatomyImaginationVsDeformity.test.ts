// Owner law "anatomy_imagination_vs_deformity" (2026-07-16):
// Regression suite guarding the three-tier verifier rubric.
// TIER 1 deformity ALWAYS fails; TIER 2 cute stylization ALWAYS passes;
// TIER 3 canonical fantasy passes when the scene/subject invites it.

import { describe, it, expect } from "vitest";
import {
  getSpeciesAnatomy,
  isFantasyCategoryKey,
  SPECIES_ANATOMY,
} from "../../supabase/functions/_shared/coloring/species-anatomy.ts";
import {
  ANATOMY_RUBRIC_SYSTEM_TEXT,
  ANATOMY_VERIFIER_VERSION,
} from "../../supabase/functions/_shared/coloring/anatomy-verify.ts";
import { normalizeDefect } from "../../supabase/functions/_shared/coloring/first-pass-learner.ts";

describe("anatomy_imagination_vs_deformity — verifier rubric contents", () => {
  it("verifier version is bumped to v3 so old degraded rows re-measure", () => {
    expect(ANATOMY_VERIFIER_VERSION).toBe("v3:imagination_vs_deformity");
  });

  it("system prompt names all three tiers explicitly", () => {
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/TIER 1[^\n]*DEFORMITY[^\n]*ALWAYS FAIL/);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/TIER 2[^\n]*CUTE STYLIZATION[^\n]*ALWAYS PASS/);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/TIER 3[^\n]*FANTASY[^\n]*PASS/);
  });

  it("system prompt explicitly whitelists eyelashes + cute stylization", () => {
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/eyelashes/i);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/Never list Tier 2 stylization in defects/i);
  });

  it("system prompt still hard-fails uninvited fantasy on realistic species", () => {
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/UNINVITED fantasy addition/i);
  });
});

describe("SPECIES_ANATOMY — Tier-2 penalty clauses have been purged", () => {
  it("dolphin eye/failure-mode clauses no longer forbid eyelashes", () => {
    const dolphin = getSpeciesAnatomy("dolphin");
    const eye = dolphin.body_parts.eye ?? "";
    expect(eye.toLowerCase()).not.toMatch(/no eyelash/);
    const modesJoined = dolphin.common_ai_failure_modes.join(" ").toLowerCase();
    expect(modesJoined).not.toMatch(/eyelash/);
    expect(modesJoined).not.toMatch(/human-like face|humanized expression/);
  });
});

describe("SPECIES_ANATOMY — fantasy creatures seeded before fantasy books render", () => {
  const mustHave = ["mermaid", "unicorn", "pegasus", "dragon", "fairy"];
  it.each(mustHave)("%s is seeded with fantasy=true", (key) => {
    const spec = SPECIES_ANATOMY.find((s) => s.species_key === key);
    expect(spec, `${key} missing from SPECIES_ANATOMY`).toBeTruthy();
    expect(spec!.fantasy).toBe(true);
  });

  it("unicorn canon: exactly ONE forehead horn + four legs", () => {
    const u = getSpeciesAnatomy("unicorn");
    expect(u.body_parts.horn.toLowerCase()).toMatch(/exactly one/);
    expect(u.body_parts.horn.toLowerCase()).toMatch(/forehead/);
    expect(u.common_ai_failure_modes.join(" ").toLowerCase()).toMatch(/two horns/);
  });

  it("mermaid canon: one human torso + one fish tail + five fingers per hand", () => {
    const m = getSpeciesAnatomy("mermaid");
    expect(m.body_parts.upper_body.toLowerCase()).toMatch(/five fingers/);
    expect(m.body_parts.lower_body.toLowerCase()).toMatch(/fish/);
    expect(m.common_ai_failure_modes.join(" ").toLowerCase()).toMatch(/six fingers|two fish tails/);
  });
});

describe("isFantasyCategoryKey — category-level fantasy tolerance", () => {
  it("recognises the queued Cute Mermaid and Ocean Fantasy category", () => {
    expect(isFantasyCategoryKey("cute_mermaid_and_ocean_fantasy")).toBe(true);
  });
  it("recognises generic fantasy tokens in the category key", () => {
    expect(isFantasyCategoryKey("unicorns_and_rainbows")).toBe(true);
    expect(isFantasyCategoryKey("dragons_and_castles")).toBe(true);
    expect(isFantasyCategoryKey("fairy_garden")).toBe(true);
  });
  it("does NOT flag realistic categories as fantasy", () => {
    expect(isFantasyCategoryKey("sea_animals")).toBe(false);
    expect(isFantasyCategoryKey("farm_animals")).toBe(false);
    expect(isFantasyCategoryKey(null)).toBe(false);
    expect(isFantasyCategoryKey(undefined)).toBe(false);
  });
});

describe("normalizeDefect — Tier-2 stylization is NEVER counted as a defect", () => {
  it("eyelashes on a dolphin are not a defect (owner-cited false positive)", () => {
    expect(normalizeDefect("human-like eyelashes on dolphin face", "dolphin", "anatomy")).toBeNull();
    expect(normalizeDefect("long lashes on the animal", "dolphin", "anatomy")).toBeNull();
  });
  it("cute smiles, blush, bows, big sparkly eyes are stylization, not defects", () => {
    expect(normalizeDefect("smiling anthropomorphic face", "fish", "anatomy")).toBeNull();
    expect(normalizeDefect("rosy cheeks / blush marks", "octopus", "anatomy")).toBeNull();
    expect(normalizeDefect("wearing a bow on the head", "cat", "anatomy")).toBeNull();
    expect(normalizeDefect("big sparkly eyes on the whale", "whale", "anatomy")).toBeNull();
    expect(normalizeDefect("humanized expression", "seal", "anatomy")).toBeNull();
  });
});

describe("normalizeDefect — real Tier-1 deformities still fail", () => {
  it("5 legs on a 4-legged animal is a Tier-1 defect", () => {
    const hit = normalizeDefect("five legs on the horse", "horse", "anatomy");
    expect(hit).not.toBeNull();
    expect(hit!.pattern_key).toBe("extra_limb");
  });
  it("6 fingers on a hand is a Tier-1 defect", () => {
    const hit = normalizeDefect("hand drawn with six fingers", "fairy", "anatomy");
    expect(hit).not.toBeNull();
    expect(hit!.pattern_key).toBe("extra_limb");
  });
  it("cetacean vertical flukes still fail", () => {
    const hit = normalizeDefect("vertical fish tail on the dolphin", "dolphin", "anatomy");
    expect(hit).not.toBeNull();
    expect(hit!.pattern_key).toBe("cetacean_horizontal_flukes");
  });
});
