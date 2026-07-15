import { describe, it, expect } from "vitest";
import {
  validateSceneContract,
  assertSceneContract,
  assertBookLockCoherence,
  SceneContractViolation,
  type SceneContract,
} from "../../supabase/functions/_shared/scene-contract.ts";

const valid = (over: Partial<SceneContract> = {}): SceneContract => ({
  page_number: 1,
  characters_required: ["Pip"],
  action_required: "Pip climbs the sticky jam jar shelf",
  emotion_required: "curious",
  setting_required: "pantry with tall shelves",
  forbidden_objects: ["text", "signature"],
  reference_asset_ids: ["ref-pip-v1", "ref-style-v1"],
  style_version: "sty_2026_07_v1",
  ...over,
});

describe("scene-contract: per-page validation", () => {
  it("accepts a well-formed contract", () => {
    expect(validateSceneContract(valid()).ok).toBe(true);
  });

  it("rejects empty reference_asset_ids (breaks character lock)", () => {
    const r = validateSceneContract(valid({ reference_asset_ids: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/reference_asset_ids/);
  });

  it("rejects missing style_version (breaks style fingerprint)", () => {
    const r = validateSceneContract(valid({ style_version: "" }));
    expect(r.ok).toBe(false);
  });

  it("rejects unknown fields (schema drift)", () => {
    const bad: Record<string, unknown> = { ...valid(), sneaky: true };
    expect(validateSceneContract(bad).ok).toBe(false);
  });

  it("rejects too-short action_required (weak brief)", () => {
    expect(validateSceneContract(valid({ action_required: "runs" })).ok).toBe(false);
  });

  it("throws SceneContractViolation on assert", () => {
    expect(() => assertSceneContract(valid({ characters_required: [] }))).toThrow(SceneContractViolation);
  });
});

describe("scene-contract: book-level lock coherence", () => {
  it("passes when every page shares refs + style", () => {
    const pages = [valid({ page_number: 1 }), valid({ page_number: 2 }), valid({ page_number: 3 })];
    expect(() => assertBookLockCoherence(pages)).not.toThrow();
  });

  it("fails when reference_asset_ids drift on any page", () => {
    const pages = [
      valid({ page_number: 1 }),
      valid({ page_number: 2, reference_asset_ids: ["ref-pip-v2"] }),
    ];
    expect(() => assertBookLockCoherence(pages)).toThrow(/reference_asset_ids drift/);
  });

  it("fails when style_version drifts on any page", () => {
    const pages = [
      valid({ page_number: 1 }),
      valid({ page_number: 2, style_version: "sty_2026_07_v2" }),
    ];
    expect(() => assertBookLockCoherence(pages)).toThrow(/style_version drift/);
  });
});
