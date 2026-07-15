// Phase 3 — Character Lock Schema (per-page scene contract).
//
// Enforces the illustrated-continuity-director contract:
//   .agents/skills/secretpdf-illustrated-continuity-director/references/
//     scene-contract.schema.json
//
// Every interior page and cover MUST carry a SceneContract before it is sent to
// the image generator. The contract binds the page to:
//   - the immutable character reference asset IDs (uploaded once per book,
//     never regenerated mid-run)
//   - the exact style_version fingerprint (see style-fingerprint.ts)
//   - the required characters / action / emotion / setting
//   - a forbidden_objects list (used by image-artifact-guard)
//
// A contract that fails validation MUST NOT be dispatched to the image model.
// The producer must repair the brief and re-emit a valid contract, never
// silently drop fields or downgrade requirements.

export interface SceneContract {
  page_number: number;
  characters_required: string[];
  props_required?: string[];
  action_required: string;
  emotion_required: string;
  setting_required: string;
  forbidden_objects: string[];
  reference_asset_ids: string[];
  style_version: string;
}

export interface SceneContractValidation {
  ok: boolean;
  errors: string[];
}

const ALLOWED_KEYS = new Set<keyof SceneContract>([
  "page_number",
  "characters_required",
  "props_required",
  "action_required",
  "emotion_required",
  "setting_required",
  "forbidden_objects",
  "reference_asset_ids",
  "style_version",
]);

function isStringArray(v: unknown, minItems = 0): v is string[] {
  return Array.isArray(v) && v.length >= minItems && v.every((x) => typeof x === "string" && x.length > 0);
}

export function validateSceneContract(c: unknown): SceneContractValidation {
  const errors: string[] = [];
  if (!c || typeof c !== "object") return { ok: false, errors: ["contract must be an object"] };
  const o = c as Record<string, unknown>;

  for (const k of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(k as keyof SceneContract)) errors.push(`unknown field: ${k}`);
  }

  if (!(typeof o.page_number === "number" && Number.isInteger(o.page_number) && o.page_number >= 1)) {
    errors.push("page_number must be integer >= 1");
  }
  if (!isStringArray(o.characters_required, 1)) errors.push("characters_required must be non-empty string[]");
  if (o.props_required !== undefined && !isStringArray(o.props_required)) errors.push("props_required must be string[]");
  if (!(typeof o.action_required === "string" && o.action_required.length >= 8)) errors.push("action_required must be string of length >= 8");
  if (!(typeof o.emotion_required === "string" && o.emotion_required.length >= 3)) errors.push("emotion_required must be string of length >= 3");
  if (!(typeof o.setting_required === "string" && o.setting_required.length >= 5)) errors.push("setting_required must be string of length >= 5");
  if (!Array.isArray(o.forbidden_objects) || !o.forbidden_objects.every((x) => typeof x === "string")) errors.push("forbidden_objects must be string[]");
  if (!isStringArray(o.reference_asset_ids, 1)) errors.push("reference_asset_ids must be non-empty string[] (immutable character refs)");
  if (!(typeof o.style_version === "string" && o.style_version.length >= 3)) errors.push("style_version must be string of length >= 3");

  return { ok: errors.length === 0, errors };
}

export class SceneContractViolation extends Error {
  readonly errors: string[];
  readonly page_number: number | null;
  constructor(page: number | null, errors: string[]) {
    super(`SceneContractViolation@page=${page ?? "?"}: ${errors.join("; ")}`);
    this.name = "SceneContractViolation";
    this.errors = errors;
    this.page_number = page;
  }
}

/** Throw if invalid. Use at the boundary right before image dispatch. */
export function assertSceneContract(c: unknown): asserts c is SceneContract {
  const r = validateSceneContract(c);
  if (!r.ok) {
    const page = (c && typeof c === "object" && typeof (c as Record<string, unknown>).page_number === "number")
      ? ((c as Record<string, unknown>).page_number as number)
      : null;
    throw new SceneContractViolation(page, r.errors);
  }
}

/**
 * Enforce that every page in a book uses the SAME immutable reference_asset_ids
 * and the SAME style_version. Any drift = character lock violation.
 */
export function assertBookLockCoherence(contracts: SceneContract[]): void {
  if (contracts.length === 0) return;
  const first = contracts[0];
  const refKey = [...first.reference_asset_ids].sort().join("|");
  const style = first.style_version;
  const drift: string[] = [];
  for (const c of contracts) {
    if ([...c.reference_asset_ids].sort().join("|") !== refKey) {
      drift.push(`page ${c.page_number}: reference_asset_ids drift`);
    }
    if (c.style_version !== style) {
      drift.push(`page ${c.page_number}: style_version drift (${c.style_version} vs ${style})`);
    }
  }
  if (drift.length) throw new SceneContractViolation(null, drift);
}
