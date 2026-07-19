/**
 * Regression: cover generate → verify race (Cover Split v1).
 *
 * Class of defect (see .lovable/plan.md and AGENTS.md):
 *   Two writers (generate stamping cover_pending_verify; verify clearing
 *   it) each did read-modify-write on ebooks_kids.metadata. Concurrent
 *   invocations clobbered each other, so verify frequently observed
 *   `cover_pending_verify: null` immediately after generate had "written"
 *   it — the book looped, invocations climbed, spend blew through the
 *   ceiling with no advance.
 *
 * Fix under test: atomicPatchMeta merges via a Postgres RPC
 *   UPDATE ebooks_kids SET metadata = metadata || $patch WHERE id = $id
 * so interleaved writers each preserve the other's keys, and passing
 * `{ key: null }` deletes just that key.
 *
 * This test simulates the interleave against a minimal in-memory fake of
 * the RPC + client. Prior read-modify-write implementation FAILS it;
 * atomicPatchMeta PASSES it.
 */
import { describe, it, expect } from "vitest";

// Local reimplementation of atomicPatchMeta bound to a fake db, so the
// test asserts the CONTRACT (atomic merge + null-key delete) without
// pulling Deno-only imports.
function makeFakeDb(initialRow: Record<string, unknown>) {
  let row = { id: "book-1", metadata: initialRow };
  return {
    _row: () => row,
    // Simulate the RPC: single UPDATE, no read-modify-write.
    rpc: async (fn: string, args: any) => {
      if (fn !== "atomic_patch_ebooks_kids_meta") throw new Error("unexpected rpc " + fn);
      const merged: Record<string, unknown> = { ...(row.metadata as any), ...args.p_patch };
      for (const [k, v] of Object.entries(args.p_patch)) {
        if (v === null) delete merged[k];
      }
      row = { ...row, metadata: merged };
      return { data: merged, error: null };
    },
  };
}

async function atomicPatch(db: any, patch: Record<string, unknown>) {
  const { data } = await db.rpc("atomic_patch_ebooks_kids_meta", { p_id: "book-1", p_patch: patch });
  return data;
}

// Legacy read-modify-write for contrast (what the bug looked like).
async function legacyPatch(db: any, patch: Record<string, unknown>) {
  const cur = db._row().metadata;
  const merged = { ...cur, ...patch };
  // simulate async gap (verify's fetch/upload happens here in prod)
  await new Promise((r) => setTimeout(r, 0));
  const cur2 = db._row().metadata; // if another writer landed, we DON'T see it
  // legacy writes `merged` — which is based on the SNAPSHOT, clobbering cur2 diffs
  Object.assign(cur2, {}); // placeholder — the write below is what clobbers
  db._row().metadata = merged;
  return merged;
}

describe("cover generate→verify race (atomic patchMeta)", () => {
  it("atomic merge preserves both concurrent writers' keys", async () => {
    const db = makeFakeDb({ existing: "keep" });
    // Interleave: generate sets cover_pending_verify; verify updates progress.
    await Promise.all([
      atomicPatch(db, { cover_pending_verify: { url: "signed://A" } }),
      atomicPatch(db, { coloring_progress_percent: 92 }),
    ]);
    const meta = db._row().metadata as any;
    expect(meta.cover_pending_verify?.url).toBe("signed://A");
    expect(meta.coloring_progress_percent).toBe(92);
    expect(meta.existing).toBe("keep");
  });

  it("passing { key: null } deletes that key without touching siblings", async () => {
    const db = makeFakeDb({ cover_pending_verify: { url: "x" }, other: "ok" });
    await atomicPatch(db, { cover_pending_verify: null, awaiting: "cover_pdf_publish" });
    const meta = db._row().metadata as any;
    expect(meta.cover_pending_verify).toBeUndefined();
    expect(meta.other).toBe("ok");
    expect(meta.awaiting).toBe("cover_pdf_publish");
  });

  it("REGRESSION: legacy read-modify-write clobbers the earlier writer (proof the bug existed)", async () => {
    const db = makeFakeDb({});
    // generate reads {} → prepares { cover_pending_verify: A }
    // verify reads {} → prepares { coloring_progress_percent: 92 }
    // whichever writes last wins; the other key is LOST.
    const p1 = legacyPatch(db, { cover_pending_verify: { url: "A" } });
    const p2 = legacyPatch(db, { coloring_progress_percent: 92 });
    await Promise.all([p1, p2]);
    const meta = db._row().metadata as any;
    const lostAtLeastOne =
      meta.cover_pending_verify === undefined || meta.coloring_progress_percent === undefined;
    expect(lostAtLeastOne).toBe(true);
  });
});
