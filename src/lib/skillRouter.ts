// Deterministic SecretPDF runtime skill router.
// Single source of truth for stage→required-skill-contract mappings.
// Mirrored in supabase/functions/_shared/skill-router.ts (keep in sync).

export type BookType = "children_illustrated" | "adult_pdf" | string;

export type PipelineStage =
  | "generate_concept"
  | "generate_manuscript"
  | "generate_story_bible"
  | "generate_page_plan"
  | "generate_character_bible"
  | "generate_cover"
  | "generate_interior"
  | "assemble_pdf"
  | "generate_sales_page"
  | "final_release";

export interface ResolveInput {
  bookType: BookType;
  ageBand?: string | null;
  category?: string | null;
  pipelineStage: PipelineStage;
  illustrationRequired?: boolean;
  storefrontRequired?: boolean;
}

export interface RuntimeSkillContract {
  skill_key: string;
  skill_version: string;
  enabled: boolean;
  supported_book_types: string[];
  supported_pipeline_stages: string[];
  trigger_tags?: string[];
  required_predecessor_skills?: string[];
  prompt_contract?: unknown;
  reference_schema?: unknown;
  qc_requirements?: unknown;
}

// Stage → required skill_keys, per book type. Deterministic, not model-guessed.
export const CHILDREN_ILLUSTRATED_STAGE_MAP: Record<PipelineStage, string[]> = {
  generate_concept: ["children_writing_standard"],
  generate_manuscript: ["children_writing_standard", "age_appropriateness"],
  generate_story_bible: ["story_bible", "age_appropriateness"],
  generate_page_plan: ["page_plan", "story_bible"],
  generate_character_bible: ["character_bible", "character_reference"],
  generate_cover: [
    "character_reference",
    "illustration_style_lock",
    "cover_art_direction",
    "image_artifact_guard",
  ],
  generate_interior: [
    "character_reference",
    "illustration_style_lock",
    "page_plan",
    "text_image_semantic_match",
    "image_artifact_guard",
  ],
  assemble_pdf: ["pdf_integrity", "typography_layout"],
  generate_sales_page: ["children_book_sales_page", "verified_product_metadata"],
  final_release: [
    "qc_contract_auditor",
    "regression_evaluation",
    "release_guardian",
  ],
};

export function resolveRequiredSkillKeys(input: ResolveInput): string[] {
  if (input.bookType !== "children_illustrated") return [];
  const base = CHILDREN_ILLUSTRATED_STAGE_MAP[input.pipelineStage] ?? [];
  const keys = new Set(base);
  if (input.illustrationRequired === false) {
    ["character_reference", "illustration_style_lock", "image_artifact_guard",
     "cover_art_direction", "text_image_semantic_match"].forEach((k) => keys.delete(k));
  }
  if (input.storefrontRequired === false) {
    ["children_book_sales_page", "verified_product_metadata"].forEach((k) => keys.delete(k));
  }
  return Array.from(keys);
}

export interface ResolvedContracts {
  stage: PipelineStage;
  required: string[];
  matched: RuntimeSkillContract[];
  missing: string[];
  disabled: string[];
}

export function resolveRequiredSkillContracts(
  input: ResolveInput,
  registry: RuntimeSkillContract[],
): ResolvedContracts {
  const required = resolveRequiredSkillKeys(input);
  const matched: RuntimeSkillContract[] = [];
  const missing: string[] = [];
  const disabled: string[] = [];
  for (const key of required) {
    const hit = registry.find(
      (c) =>
        c.skill_key === key &&
        c.supported_book_types.includes(input.bookType) &&
        c.supported_pipeline_stages.includes(input.pipelineStage),
    );
    if (!hit) {
      missing.push(key);
      continue;
    }
    if (!hit.enabled) {
      disabled.push(key);
      continue;
    }
    matched.push(hit);
  }
  return { stage: input.pipelineStage, required, matched, missing, disabled };
}

export class MissingRequiredSkillContract extends Error {
  readonly code = "missing_required_skill_contract";
  constructor(readonly skill_key: string, readonly stage: string) {
    super(`missing_required_skill_contract:${skill_key} for stage ${stage}`);
  }
}

export function assertContractsReady(resolved: ResolvedContracts): void {
  const blockers = [...resolved.missing, ...resolved.disabled];
  if (blockers.length > 0) {
    throw new MissingRequiredSkillContract(blockers[0], resolved.stage);
  }
}

// Character-lock evidence contract for illustrated books.
export interface CharacterLockEvidence {
  story_bible_id: string | null;
  character_bible_id: string | null;
  character_reference_id: string | null;
  style_version: string | null;
}

export class MissingCharacterLockReference extends Error {
  readonly code = "missing_character_lock_reference";
  constructor(readonly field: keyof CharacterLockEvidence) {
    super(`missing_character_lock_reference:${field}`);
  }
}

export function assertCharacterLockReady(
  evidence: CharacterLockEvidence,
  stage: PipelineStage,
): void {
  const needsLock: PipelineStage[] = ["generate_cover", "generate_interior", "final_release"];
  if (!needsLock.includes(stage)) return;
  const required: (keyof CharacterLockEvidence)[] = [
    "story_bible_id",
    "character_bible_id",
    "character_reference_id",
    "style_version",
  ];
  for (const f of required) {
    if (!evidence[f]) throw new MissingCharacterLockReference(f);
  }
}
