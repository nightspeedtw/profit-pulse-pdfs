// Atomic metadata patch for ebooks_kids.
//
// Root cause this fixes: `patchMeta` used to be read-modify-write from the
// application layer. Two concurrent writers (e.g. coloring-cover-generate
// stamping `cover_pending_verify` while coloring-cover-verify clears it,
// or the fire-and-forget verify racing the generate's own final patch)
// would clobber each other because both loaded the SAME `metadata` blob,
// merged their delta into it locally, and wrote the whole thing back.
//
// The atomic helper delegates the merge to Postgres via the
// `atomic_patch_ebooks_kids_meta(uuid, jsonb)` RPC, which does:
//     UPDATE ebooks_kids
//        SET metadata = metadata || $patch
//      WHERE id = $id
// and strips keys whose patch value is JSON null (so callers can still
// "delete a key" by setting `{ some_key: null }`).
//
// All new code MUST use `atomicPatchMeta`. The legacy read-modify-write
// path is retained here only as a labeled fallback in case the RPC is not
// yet deployed to the target project during a rolling migration; it logs
// a warning so it can be removed once every environment is on the RPC.

// @ts-nocheck  Deno edge runtime
import { sanitizeMetadataPatchForPersist } from "./coloring/metadata-bloat-guard.ts";

export async function atomicPatchMeta(
  db: any,
  ebookId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!ebookId) throw new Error("atomicPatchMeta: ebookId required");
  const { data, error } = await db.rpc("atomic_patch_ebooks_kids_meta", {
    p_id: ebookId,
    p_patch: patch ?? {},
  });
  if (error) {
    console.warn("[atomicPatchMeta] rpc failed, falling back to read-modify-write", error.message);
    return await legacyPatchMeta(db, ebookId, patch);
  }
  return (data ?? null) as Record<string, unknown> | null;
}

async function legacyPatchMeta(
  db: any,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", id).single();
  const merged: Record<string, unknown> = { ...((data?.metadata ?? {}) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  const clean = sanitizeMetadataPatchForPersist(merged);
  await db.from("ebooks_kids").update({ metadata: clean }).eq("id", id);
  return clean;
}
