// Shared helpers for loading character-lock evidence and safely emitting
// skill-usage evidence rows from producer edge functions. Producers that
// throw a lock/router error must not silently continue — the pipeline
// escalates via the existing error taxonomy.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  assertContractsReady,
  assertCharacterLockReady,
  CHILDREN_ILLUSTRATED_STAGE_MAP,
  logSkillUsage,
  MissingCharacterLockReference,
  MissingRequiredSkillContract,
  resolveRequiredSkillContracts,
  type CharacterLockEvidence,
  type PipelineStage,
  type ResolvedContracts,
  type RuntimeSkillContract,
} from "./skill-router.ts";

export { MissingRequiredSkillContract, MissingCharacterLockReference };

function client(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function loadCharacterLock(
  bookId: string,
  db: SupabaseClient = client(),
): Promise<CharacterLockEvidence> {
  const { data, error } = await db
    .from("ebooks_kids")
    .select("story_bible_id, character_bible_id, character_reference_id, style_version")
    .eq("id", bookId)
    .maybeSingle();
  if (error) throw error;
  return {
    story_bible_id: (data?.story_bible_id as string) ?? null,
    character_bible_id: (data?.character_bible_id as string) ?? null,
    character_reference_id: (data?.character_reference_id as string) ?? null,
    style_version: (data?.style_version as string) ?? null,
  };
}

export async function assertCoverOrInteriorReady(
  bookId: string,
  stage: "generate_cover" | "generate_interior",
  db?: SupabaseClient,
): Promise<CharacterLockEvidence> {
  const evidence = await loadCharacterLock(bookId, db);
  assertCharacterLockReady(evidence, stage);
  return evidence;
}

async function loadRegistryFor(stage: PipelineStage): Promise<RuntimeSkillContract[]> {
  const { data, error } = await client()
    .from("runtime_skill_contracts")
    .select("*")
    .contains("supported_book_types", ["children_illustrated"])
    .contains("supported_pipeline_stages", [stage]);
  if (error) throw error;
  return (data ?? []) as RuntimeSkillContract[];
}

export async function resolveStageOrThrow(
  stage: PipelineStage,
  opts: { illustrationRequired?: boolean; storefrontRequired?: boolean } = {},
): Promise<ResolvedContracts> {
  const registry = await loadRegistryFor(stage);
  const resolved = resolveRequiredSkillContracts(
    { bookType: "children_illustrated", pipelineStage: stage, ...opts },
    registry,
  );
  assertContractsReady(resolved);
  return resolved;
}

export interface StageUsageContext {
  run_id?: string | null;
  book_id: string;
  input_reference_ids?: string[];
  output_asset_ids?: string[];
  pass_fail_result?: "pass" | "fail" | "pending";
}

// Best-effort logger. Producers must not have their happy path broken by a
// logging failure, so we swallow non-throwing errors — but a *missing*
// contract still escalates (resolveStageOrThrow throws before we get here).
export async function logStageEvidence(
  resolved: ResolvedContracts,
  ctx: StageUsageContext,
): Promise<void> {
  await Promise.all(resolved.matched.map(async (c) => {
    try {
      await logSkillUsage({
        run_id: ctx.run_id ?? null,
        book_id: ctx.book_id,
        stage: resolved.stage,
        skill_key: c.skill_key,
        skill_version: c.skill_version,
        input_reference_ids: ctx.input_reference_ids ?? [],
        output_asset_ids: ctx.output_asset_ids ?? [],
        pass_fail_result: ctx.pass_fail_result ?? "pass",
      });
    } catch (e) {
      console.warn("[stage-evidence] log failed", c.skill_key, (e as Error).message);
    }
  }));
}

// Convenience: run entry+exit around a producer body.
export async function withStageEvidence<T>(
  stage: PipelineStage,
  ctx: StageUsageContext & { opts?: { illustrationRequired?: boolean; storefrontRequired?: boolean } },
  body: () => Promise<{ result: T; output_asset_ids?: string[]; input_reference_ids?: string[] }>,
): Promise<T> {
  const resolved = await resolveStageOrThrow(stage, ctx.opts);
  const out = await body();
  await logStageEvidence(resolved, {
    ...ctx,
    output_asset_ids: out.output_asset_ids ?? ctx.output_asset_ids,
    input_reference_ids: out.input_reference_ids ?? ctx.input_reference_ids,
    pass_fail_result: "pass",
  });
  return out.result;
}

// Re-export for producers that want the raw stage keys.
export { CHILDREN_ILLUSTRATED_STAGE_MAP };
