import { describe, expect, it } from "vitest";
import {
  resolveRequiredSkillKeys,
  resolveRequiredSkillContracts,
  assertContractsReady,
  assertCharacterLockReady,
  MissingRequiredSkillContract,
  MissingCharacterLockReference,
  CHILDREN_ILLUSTRATED_STAGE_MAP,
  type RuntimeSkillContract,
  type PipelineStage,
} from "./skillRouter";

const ALL_KEYS = Array.from(
  new Set(Object.values(CHILDREN_ILLUSTRATED_STAGE_MAP).flat()),
);

function fixtureRegistry(overrides: Partial<Record<string, Partial<RuntimeSkillContract>>> = {}): RuntimeSkillContract[] {
  return ALL_KEYS.map((k) => ({
    skill_key: k,
    skill_version: "1.0.0",
    enabled: true,
    supported_book_types: ["children_illustrated"],
    supported_pipeline_stages: Object.entries(CHILDREN_ILLUSTRATED_STAGE_MAP)
      .filter(([, keys]) => keys.includes(k))
      .map(([stage]) => stage),
    ...overrides[k],
  }));
}

describe("skillRouter — stage mapping", () => {
  it("generate_cover requires the four cover skills", () => {
    expect(resolveRequiredSkillKeys({ bookType: "children_illustrated", pipelineStage: "generate_cover" }))
      .toEqual(expect.arrayContaining([
        "character_reference", "illustration_style_lock", "cover_art_direction", "image_artifact_guard",
      ]));
  });

  it("generate_interior requires the five interior skills", () => {
    expect(resolveRequiredSkillKeys({ bookType: "children_illustrated", pipelineStage: "generate_interior" }))
      .toEqual(expect.arrayContaining([
        "character_reference", "illustration_style_lock", "page_plan",
        "text_image_semantic_match", "image_artifact_guard",
      ]));
  });

  it("final_release requires qc_contract_auditor + regression_evaluation + release_guardian", () => {
    expect(resolveRequiredSkillKeys({ bookType: "children_illustrated", pipelineStage: "final_release" }))
      .toEqual(expect.arrayContaining([
        "qc_contract_auditor", "regression_evaluation", "release_guardian",
      ]));
  });

  it("non-children book types resolve to empty", () => {
    expect(resolveRequiredSkillKeys({ bookType: "adult_pdf", pipelineStage: "generate_cover" })).toEqual([]);
  });
});

describe("skillRouter — registry resolution", () => {
  it("all required contracts present → no missing, no disabled", () => {
    const reg = fixtureRegistry();
    const r = resolveRequiredSkillContracts(
      { bookType: "children_illustrated", pipelineStage: "generate_cover" }, reg,
    );
    expect(r.missing).toEqual([]);
    expect(r.disabled).toEqual([]);
    expect(r.matched.length).toBe(4);
  });

  it("missing contract → listed as missing and blocks", () => {
    const reg = fixtureRegistry().filter((c) => c.skill_key !== "image_artifact_guard");
    const r = resolveRequiredSkillContracts(
      { bookType: "children_illustrated", pipelineStage: "generate_cover" }, reg,
    );
    expect(r.missing).toContain("image_artifact_guard");
    expect(() => assertContractsReady(r)).toThrow(MissingRequiredSkillContract);
  });

  it("disabled contract blocks with same error class", () => {
    const reg = fixtureRegistry({ image_artifact_guard: { enabled: false } });
    const r = resolveRequiredSkillContracts(
      { bookType: "children_illustrated", pipelineStage: "generate_cover" }, reg,
    );
    expect(r.disabled).toContain("image_artifact_guard");
    expect(() => assertContractsReady(r)).toThrow(/missing_required_skill_contract/);
  });
});

describe("skillRouter — character lock evidence", () => {
  const stages: PipelineStage[] = ["generate_cover", "generate_interior", "final_release"];
  for (const s of stages) {
    it(`${s} requires all four lock fields`, () => {
      expect(() => assertCharacterLockReady({
        story_bible_id: "s", character_bible_id: "cb",
        character_reference_id: null, style_version: "v1",
      }, s)).toThrow(MissingCharacterLockReference);
    });
  }
  it("early stages do not require the lock", () => {
    expect(() => assertCharacterLockReady({
      story_bible_id: null, character_bible_id: null,
      character_reference_id: null, style_version: null,
    }, "generate_concept")).not.toThrow();
  });
});
