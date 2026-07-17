import { describe, it, expect } from "vitest";
import {
  getSpeciesAnatomy,
  hasSpeciesAnatomy,
  speciesAnatomyPromptClause,
  assertSpeciesCoverage,
  isNonAnatomySubject,
} from "../../supabase/functions/_shared/coloring/species-anatomy.ts";

// chimera-anatomy-v1 (owner 2026-07-17): quadrupeds MUST resolve to a
// species contract that states exactly 4 legs. Fantasy creatures resolve
// to their own contract (not rejected). Categories with subjects lacking
// any contract must be blocked by the coverage gate.

describe("species anatomy contract coverage", () => {
  const quadrupeds = [
    "puppy", "kitten", "bunny", "bear", "fox", "raccoon",
    "cow", "pig", "sheep", "goat", "horse",
    "elephant", "lion", "tiger", "giraffe", "zebra",
    "triceratops", "brachiosaurus",
  ];

  for (const q of quadrupeds) {
    it(`${q} has a specific species contract with a 4-leg rule`, () => {
      expect(hasSpeciesAnatomy(q)).toBe(true);
      const clause = speciesAnatomyPromptClause(q);
      expect(clause).toMatch(/FOUR|four/);
    });
  }

  it("t-rex is bipedal (2 legs + 2 small arms), not quadruped", () => {
    const spec = getSpeciesAnatomy("t-rex");
    expect(spec.species_key).toBe("t-rex");
    expect(JSON.stringify(spec.body_parts)).toMatch(/TWO powerful hind legs/);
  });

  it("chicken enforces 2-leg bird plan (not 4 legs)", () => {
    const clause = speciesAnatomyPromptClause("chicken");
    expect(clause).toMatch(/never 4 legs/);
  });

  it("fantasy creatures (unicorn, dragon, mermaid) resolve to their own contract, not rejected", () => {
    for (const f of ["unicorn", "dragon", "mermaid", "pegasus", "fairy"]) {
      expect(hasSpeciesAnatomy(f)).toBe(true);
    }
  });

  it("assertSpeciesCoverage flags subjects with no contract", () => {
    const res = assertSpeciesCoverage(["puppy", "cow", "unknown-creature-blob"]);
    expect(res.ok).toBe(false);
    expect(res.missing.map((m) => m.subject)).toContain("unknown-creature-blob");
  });

  it("assertSpeciesCoverage exempts non-anatomical scene/object subjects", () => {
    const res = assertSpeciesCoverage([
      "mandala", "castle", "flower bouquet", "teacup", "enchanted forest",
    ]);
    expect(res.ok).toBe(true);
  });

  it("isNonAnatomySubject recognizes patterns/objects/scenes", () => {
    expect(isNonAnatomySubject("mandala pattern")).toBe(true);
    expect(isNonAnatomySubject("castle")).toBe(true);
    expect(isNonAnatomySubject("puppy")).toBe(false);
  });
});
