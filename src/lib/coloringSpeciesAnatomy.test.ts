import { describe, it, expect } from "vitest";
import {
  getSpeciesAnatomy,
  speciesAnatomyPromptClause,
  speciesAnatomyRepairClause,
  speciesAnatomyChecklistJson,
  hasSpeciesAnatomy,
  SPECIES_ANATOMY,
} from "../../supabase/functions/_shared/coloring/species-anatomy.ts";
import {
  summarizeBookAnatomy,
  ANATOMY_VERIFIER_VERSION,
  type AnatomyPageVerdict,
} from "../../supabase/functions/_shared/coloring/anatomy-verify.ts";
import { classifyFailure } from "../../supabase/functions/_shared/coloring/repair-ladder.ts";
import { coloringBookWeightedGate } from "../../supabase/functions/_shared/coloring/gates.ts";

// ── SPECIES_ANATOMY_SKILL — Layer 1 (prevent) ─────────────────────────
describe("SPECIES_ANATOMY_SKILL", () => {
  it("resolves canonical + alias subjects to the same spec", () => {
    expect(getSpeciesAnatomy("dolphin").species_key).toBe("dolphin");
    expect(getSpeciesAnatomy("BOTTLENOSE DOLPHIN").species_key).toBe("dolphin");
    expect(getSpeciesAnatomy("Tropical Fish").species_key).toBe("fish");
    expect(getSpeciesAnatomy("sea star").species_key).toBe("starfish");
  });

  it("falls back to __generic__ for unknown subjects without crashing", () => {
    expect(getSpeciesAnatomy("dragon-unicorn-thing").species_key).toBe("__generic__");
    expect(hasSpeciesAnatomy("dolphin")).toBe(true);
    expect(hasSpeciesAnatomy("dragon-unicorn-thing")).toBe(false);
  });

  it("dolphin checklist names the exact owner-observed defect class (horizontal flukes)", () => {
    const spec = getSpeciesAnatomy("dolphin");
    const tailRule = spec.body_parts.tail.toLowerCase();
    expect(tailRule).toMatch(/horizontal/);
    expect(tailRule).toMatch(/never vertical|never mermaid|split/);
    expect(spec.common_ai_failure_modes.join(" ").toLowerCase()).toMatch(/mermaid|y-shaped/);
  });

  it("fish checklist forbids the balloon-body + beak-mouth failure modes", () => {
    const spec = getSpeciesAnatomy("fish");
    expect(spec.body_parts.mouth.toLowerCase()).toMatch(/no bird beak/);
    expect(spec.proportion_rules.join(" ").toLowerCase()).toMatch(/no balloon body/);
    expect(spec.common_ai_failure_modes.join(" ").toLowerCase()).toMatch(/balloon.*body/);
  });

  it("prompt clause injects positive spec + failure modes", () => {
    const clause = speciesAnatomyPromptClause("dolphin");
    expect(clause).toMatch(/Anatomical spec for dolphin/i);
    expect(clause).toMatch(/HORIZONTAL/);
    expect(clause).toMatch(/Avoid these known AI failure modes/i);
  });

  it("repair clause names the exact observed defects when supplied", () => {
    const clause = speciesAnatomyRepairClause("dolphin", ["vertical mermaid tail", "wrong pectoral fin count"]);
    expect(clause).toMatch(/vertical mermaid tail/);
    expect(clause).toMatch(/wrong pectoral fin count/);
    expect(clause).toMatch(/dolphin/);
  });

  it("checklist json is stable + matches the seeded species set", () => {
    const seeded = SPECIES_ANATOMY.map((s) => s.species_key).sort();
    expect(seeded).toContain("dolphin");
    expect(seeded).toContain("fish");
    expect(seeded).toContain("narwhal");
    expect(speciesAnatomyChecklistJson("dolphin").species_key).toBe("dolphin");
  });
});

// ── Repair ladder classifies anatomy defects into the structural rung ─
describe("repair-ladder anatomy classification", () => {
  it("routes anatomy defect reasons to anatomy_structural", () => {
    expect(classifyFailure(["anatomy_structural", "vertical mermaid tail"])).toBe("anatomy_structural");
    expect(classifyFailure(["balloon body", "leaf-shaped fin"])).toBe("anatomy_structural");
  });
});

// ── Assemble contract: measured anatomy summary ───────────────────────
describe("summarizeBookAnatomy (assemble gate)", () => {
  const now = new Date().toISOString();
  const mk = (page: number, subject: string, pass: boolean, score: number, degraded = false): AnatomyPageVerdict => ({
    page, subject, species_key: subject, pass, anatomy_score: score,
    defects: pass ? [] : ["synthetic_defect"],
    degraded, measured_at: now, measured_version: ANATOMY_VERIFIER_VERSION,
  });

  it("owner fixture: dolphin p2 + fish p28 FAIL the gate", () => {
    const verdicts = [
      mk(2, "dolphin", false, 42),   // mermaid tail
      mk(28, "fish", false, 38),     // balloon body / beak mouth
      mk(1, "octopus", true, 96),
    ];
    const summary = summarizeBookAnatomy(verdicts, [1, 2, 28]);
    expect(summary.every_page_measured).toBe(true);
    expect(summary.hard_fail_pages.map((p) => p.page).sort()).toEqual([2, 28]);
    expect(summary.min_page_score).toBe(38);
  });

  it("correct reference pages PASS the gate", () => {
    const verdicts = [
      mk(1, "dolphin", true, 94),
      mk(2, "fish", true, 92),
      mk(3, "octopus", true, 96),
    ];
    const summary = summarizeBookAnatomy(verdicts, [1, 2, 3]);
    expect(summary.every_page_measured).toBe(true);
    expect(summary.hard_fail_pages).toHaveLength(0);
    expect(summary.min_page_score).toBeGreaterThanOrEqual(92);
  });

  it("a page with NO verdict is treated as UNMEASURED (never 95 default)", () => {
    const verdicts = [mk(1, "dolphin", true, 94)];
    const summary = summarizeBookAnatomy(verdicts, [1, 2]);
    expect(summary.every_page_measured).toBe(false);
    expect(summary.unmeasured_pages).toEqual([2]);
  });

  it("a degraded verdict is treated as UNMEASURED", () => {
    const verdicts = [mk(1, "dolphin", false, 0, true)];
    const summary = summarizeBookAnatomy(verdicts, [1]);
    expect(summary.every_page_measured).toBe(false);
    expect(summary.unmeasured_pages).toEqual([1]);
  });
});

// ── Book gate: unmeasured/failed anatomy pulls anatomy_correctness down
describe("coloringBookWeightedGate reads MEASURED anatomy min (not 95)", () => {
  const base = {
    theme_fit: 96, age_fit: 96,
    line_art_cleanliness: 96, colorability: 94,
    composition_margins: 96, visual_appeal: 94,
    originality_diversity: 92, style_consistency: 96,
    per_page_scores: [92, 92, 92],
    hard_fails_total: 0,
    duplicate_scene_rate: 0,
    spelling_ok: true,
  };

  it("measured min 42 FAILS what a constant 95 used to pass silently", () => {
    const measured = coloringBookWeightedGate({ ...base, anatomy_correctness: 42 });
    const legacyConstant = coloringBookWeightedGate({ ...base, anatomy_correctness: 95 });
    expect(measured.pass).toBe(false);
    expect(legacyConstant.pass).toBe(true);
    expect(measured.weighted_avg).toBeLessThan(legacyConstant.weighted_avg);
  });
});
