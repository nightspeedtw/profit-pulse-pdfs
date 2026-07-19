// Owner law "anatomy_deformity_only_v2" (2026-07-16, supersedes v1):
// The anatomy gate answers ONE question — "does this creature look
// deformed / injured / disabled?" All imaginary beings pass in ANY
// category so long as they match their canonical imaginative form.
// Category / theme fit is a SEPARATE gate.

import { describe, it, expect } from "vitest";
import {
  getSpeciesAnatomy,
  SPECIES_ANATOMY,
} from "../../supabase/functions/_shared/coloring/species-anatomy.ts";
import {
  ANATOMY_RUBRIC_SYSTEM_TEXT,
  ANATOMY_VERIFIER_VERSION,
} from "../../supabase/functions/_shared/coloring/anatomy-verify.ts";
import { normalizeDefect } from "../../supabase/functions/_shared/coloring/first-pass-learner.ts";

describe("anatomy_deformity_only_v2 — verifier rubric contents", () => {
  it("verifier version bumped so stale verdicts re-measure (v6 promotes deformity to hard gate)", () => {
    expect(ANATOMY_VERIFIER_VERSION).toBe("v6:deformity_hard_gate");
  });

  it("rubric asks the ONE deformity question", () => {
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/broken, injured, disabled, or malformed/i);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/rather than merely stylized or fantastical/i);
  });

  it("rubric explicitly permits ALL imaginary beings in ANY category", () => {
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/ALL imaginary beings in ANY category/i);
  });

  it("rubric also asks the recognizability (blob/potato/egg) question", () => {
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/amorphous blob/i);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/egg.*with a face/i);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/recognizable/i);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/unrecognizable_subject/);
  });

  it("rubric lists canonical mythical / divine forms with generous allowance", () => {
    const t = ANATOMY_RUBRIC_SYSTEM_TEXT;
    expect(t).toMatch(/naga/i);
    expect(t).toMatch(/garuda/i);
    expect(t).toMatch(/kinnari/i);
    expect(t).toMatch(/erawan|airavata/i);
    expect(t).toMatch(/nine[- ]tailed fox|kitsune/i);
    expect(t).toMatch(/multi-armed deities?/i);
    expect(t).toMatch(/mermaid/i);
    expect(t).toMatch(/unicorn/i);
    expect(t).toMatch(/phoenix/i);
    expect(t).toMatch(/dragon/i);
  });

  it("rubric explicitly whitelists cuteness / stylization", () => {
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/eyelashes/i);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).toMatch(/Never list stylization/i);
  });

  it("rubric NO LONGER contains the v1 'uninvited fantasy' anatomy-fail clause", () => {
    // v1 said uninvited fantasy in realistic categories was a Tier 1 fail —
    // owner has explicitly removed this restriction; anatomy does not police
    // theme any longer.
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).not.toMatch(/UNINVITED fantasy addition/i);
    expect(ANATOMY_RUBRIC_SYSTEM_TEXT).not.toMatch(/TIER 1|TIER 2|TIER 3/);
  });
});

describe("SPECIES_ANATOMY — mythical / divine beings seeded before render", () => {
  const mustHave = [
    "mermaid", "unicorn", "pegasus", "dragon", "fairy",
    "phoenix", "naga", "garuda", "kinnari", "erawan",
    "nine_tailed_fox", "kirin", "deity", "human",
  ];
  it.each(mustHave)("%s is seeded", (key) => {
    const spec = SPECIES_ANATOMY.find((s) => s.species_key === key);
    expect(spec, `${key} missing from SPECIES_ANATOMY`).toBeTruthy();
  });

  it("multi-armed deity canon: many arms allowed, five fingers per hand still required", () => {
    const d = getSpeciesAnatomy("four-armed deity");
    expect(d.species_key).toBe("deity");
    expect(d.body_parts.arms.toLowerCase()).toMatch(/multiple arms/);
    expect(d.body_parts.arms.toLowerCase()).toMatch(/five fingers/);
    expect(d.proportion_rules.join(" ").toLowerCase()).toMatch(/canonical/);
  });

  it("nine-tailed fox canon: 1-9 tails is canonical, not a defect", () => {
    const f = getSpeciesAnatomy("kitsune");
    expect(f.species_key).toBe("nine_tailed_fox");
    expect(f.body_parts.tails.toLowerCase()).toMatch(/1 through 9|nine tails/);
  });

  it("erawan / airavata canon: multi-head elephant is canonical", () => {
    const e = getSpeciesAnatomy("three-headed elephant");
    expect(e.species_key).toBe("erawan");
    expect(e.body_parts.heads.toLowerCase()).toMatch(/multiple/);
    expect(e.body_parts.legs.toLowerCase()).toMatch(/four legs/);
  });

  it("human canon: 2 arms, 2 legs, 5 fingers per hand", () => {
    const h = getSpeciesAnatomy("child");
    expect(h.species_key).toBe("human");
    expect(h.body_parts.arms.toLowerCase()).toMatch(/two arms/);
    expect(h.body_parts.arms.toLowerCase()).toMatch(/five fingers/);
    expect(h.common_ai_failure_modes.join(" ").toLowerCase()).toMatch(/third arm/);
  });
});

describe("normalizeDefect — deformity taxonomy", () => {
  it("cuteness (eyelashes, blush, bows) NEVER counts as a defect", () => {
    expect(normalizeDefect("human-like eyelashes on dolphin face", "dolphin", "anatomy")).toBeNull();
    expect(normalizeDefect("rosy cheeks / blush marks", "octopus", "anatomy")).toBeNull();
    expect(normalizeDefect("wearing a bow on the head", "cat", "anatomy")).toBeNull();
  });

  it("5 legs on a 4-legged animal is a deformity", () => {
    const hit = normalizeDefect("five legs on the horse", "horse", "anatomy");
    expect(hit?.pattern_key).toBe("extra_limb");
  });

  it("6 fingers on a human hand is a deformity", () => {
    const hit = normalizeDefect("hand drawn with six fingers", "human", "anatomy");
    expect(hit?.pattern_key).toBe("extra_limb");
  });

  it("3 arms on a human is a deformity", () => {
    const hit = normalizeDefect("extra arm sprouting from the human torso", "human", "anatomy");
    expect(hit?.pattern_key).toBe("extra_limb");
  });
});
