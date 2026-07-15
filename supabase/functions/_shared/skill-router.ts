// Edge-runtime mirror of src/lib/skillRouter.ts. Keep in sync.
// Adds Supabase-side helpers to load the registry and persist run_skill_usage.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

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

export interface ResolveInput {
  bookType: BookType;
  ageBand?: string | null;
  category?: string | null;
  pipelineStage: PipelineStage;
  illustrationRequired?: boolean;
  storefrontRequired?: boolean;
}

export function resolveRequiredSkillKeys(input: ResolveInput): string[] {
  if (input.bookType !== "children_illustrated") return [];
  const base = CHILDREN_ILLUSTRATED_STAGE_MAP[input.pipelineStage] ?? [];
  const keys = new Set(base);
  if (input.illustrationRequired === false) {
    ["character_reference","illustration_style_lock","image_artifact_guard",
     "cover_art_direction","text_image_semantic_match"].forEach((k) => keys.delete(k));
  }
  if (input.storefrontRequired === false) {
    ["children_book_sales_page","verified_product_metadata"].forEach((k) => keys.delete(k));
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
    if (!hit) { missing.push(key); continue; }
    if (!hit.enabled) { disabled.push(key); continue; }
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

export function assertContractsReady(r: ResolvedContracts): void {
  const blockers = [...r.missing, ...r.disabled];
  if (blockers.length > 0) throw new MissingRequiredSkillContract(blockers[0], r.stage);
}

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
  evidence: CharacterLockEvidence, stage: PipelineStage,
): void {
  const needsLock: PipelineStage[] = ["generate_cover","generate_interior","final_release"];
  if (!needsLock.includes(stage)) return;
  for (const f of ["story_bible_id","character_bible_id","character_reference_id","style_version"] as const) {
    if (!evidence[f]) throw new MissingCharacterLockReference(f);
  }
}

// ---- Supabase-side helpers ----

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

export async function loadRegistry(bookType: BookType): Promise<RuntimeSkillContract[]> {
  const { data, error } = await client()
    .from("runtime_skill_contracts")
    .select("*")
    .contains("supported_book_types", [bookType]);
  if (error) throw error;
  return (data ?? []) as RuntimeSkillContract[];
}

export async function resolveAndAssert(input: ResolveInput): Promise<ResolvedContracts> {
  const registry = await loadRegistry(input.bookType);
  const resolved = resolveRequiredSkillContracts(input, registry);
  assertContractsReady(resolved);
  return resolved;
}

export interface LogSkillUsageInput {
  run_id?: string | null;
  book_id?: string | null;
  stage: PipelineStage;
  skill_key: string;
  skill_version: string;
  input_reference_ids?: string[];
  output_asset_ids?: string[];
  pass_fail_result?: "pass" | "fail" | "pending";
  details?: Record<string, unknown>;
}

export async function logSkillUsage(entry: LogSkillUsageInput): Promise<void> {
  const { error } = await client().from("run_skill_usage").insert({
    run_id: entry.run_id ?? null,
    book_id: entry.book_id ?? null,
    stage: entry.stage,
    skill_key: entry.skill_key,
    skill_version: entry.skill_version,
    input_reference_ids: entry.input_reference_ids ?? [],
    output_asset_ids: entry.output_asset_ids ?? [],
    pass_fail_result: entry.pass_fail_result ?? "pending",
    details: entry.details ?? {},
  });
  if (error) throw error;
}

export async function logResolvedUsage(
  resolved: ResolvedContracts,
  ctx: { run_id?: string | null; book_id?: string | null;
         input_reference_ids?: string[]; output_asset_ids?: string[];
         pass_fail_result?: "pass" | "fail" | "pending" },
): Promise<void> {
  await Promise.all(resolved.matched.map((c) => logSkillUsage({
    ...ctx,
    stage: resolved.stage,
    skill_key: c.skill_key,
    skill_version: c.skill_version,
  })));
}

export async function assertFinalReleaseSkillEvidence(
  book_id: string, run_id: string | null,
): Promise<void> {
  const required = CHILDREN_ILLUSTRATED_STAGE_MAP.final_release;
  const q = client().from("run_skill_usage")
    .select("skill_key")
    .eq("book_id", book_id)
    .in("skill_key", required);
  const { data, error } = await q;
  if (error) throw error;
  const seen = new Set((data ?? []).map((r: { skill_key: string }) => r.skill_key));
  const missing = required.filter((k) => !seen.has(k));
  if (missing.length > 0) {
    throw new MissingRequiredSkillContract(missing[0], "final_release");
  }
  // touch run_id so callers can pass it for future audit joins
  void run_id;
}
