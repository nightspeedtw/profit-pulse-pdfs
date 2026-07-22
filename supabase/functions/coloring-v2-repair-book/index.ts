// coloring-v2-repair-book — resumable one-shot repair for a single book.
//
// Runs in bounded batches to avoid Deno edge WORKER_RESOURCE_LIMIT:
//   • Each invocation processes up to BATCH_SIZE unchecked interior pages.
//   • Writes anatomy verdict into meta.repair_verdict so a re-run skips
//     already-checked pages (idempotent).
//   • When every interior asset has a verdict, performs the finalize step:
//     drop failing/duplicate/cover assets, reset stage → interior_render,
//     fire coloring-v2-render-page at the lowest missing page.
//
// Client usage (loop until finalized=true):
//   POST { book_id } → { finalized:false, remaining:N, checked_this_run:X }
//   POST { book_id } → { finalized:false, remaining:N-X, ... }
//   ...
//   POST { book_id } → { finalized:true, failed_pages:[...], next_page_fired:1 }
//
// Also supports { dry_run:true } which returns current progress without
// mutating anything.
// @ts-nocheck
import { corsHeaders, db, fetchBook, fireStage, json, signedUrl } from "../_shared/coloring-v2/state.ts";
import { checkPageAnatomy } from "../_shared/coloring-v2/anatomy-check.ts";

declare const Deno: any;

const BATCH_SIZE = 6;

async function fetchBytes(path: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const url = await signedUrl(path, 600);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch_bytes_${r.status}:${path}`);
  const ab = await r.arrayBuffer();
  return { bytes: new Uint8Array(ab), mime: r.headers.get("content-type") ?? "image/jpeg" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id, dry_run } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);

  const book = await fetchBook(book_id);
  const c = db();

  // Load interior assets (all rows so we can dedupe).
  const { data: interiors, error: iErr } = await c.from("coloring_v2_assets")
    .select("id, page_number, storage_path, created_at, meta")
    .eq("book_id", book_id).eq("kind", "interior")
    .order("page_number", { ascending: true })
    .order("created_at", { ascending: false });
  if (iErr) return json({ error: iErr.message }, 500);

  // Dedupe: latest per page_number is the keeper; older are duplicates.
  const seen = new Set<number>();
  const keep: Array<{ id: string; page_number: number; storage_path: string; meta: any }> = [];
  const dupIds: string[] = []; const dupPaths: string[] = [];
  for (const a of interiors ?? []) {
    if (seen.has(a.page_number)) { dupIds.push(a.id); dupPaths.push(a.storage_path); continue; }
    seen.add(a.page_number);
    keep.push(a);
  }

  const unchecked = keep.filter((a) => !a.meta?.repair_verdict);
  const checked = keep.filter((a) => a.meta?.repair_verdict);

  if (dry_run) {
    return json({
      ok: true, dry_run: true,
      total_kept: keep.length, checked: checked.length, unchecked: unchecked.length,
      duplicates: dupIds.length,
    });
  }

  // Load plans for subjects.
  const { data: plans } = await c.from("coloring_v2_page_plans")
    .select("page_number, focal_subject, scene").eq("book_id", book_id);
  const planByPage = new Map<number, any>();
  for (const p of plans ?? []) planByPage.set(p.page_number, p);

  // Process one bounded batch.
  const batch = unchecked.slice(0, BATCH_SIZE);
  const batchResults: Array<{ page: number; pass: boolean; degraded: boolean; score: number; defects: string[] }> = [];

  for (const a of batch) {
    const plan = planByPage.get(a.page_number);
    const subject = plan?.focal_subject || plan?.scene || book.theme || "the subject";
    let verdictPatch: any;
    try {
      const { bytes, mime } = await fetchBytes(a.storage_path);
      const v = await checkPageAnatomy({ bytes, mime, subject, scene: plan?.scene ?? "" });
      verdictPatch = {
        pass: v.pass, degraded: v.degraded, score: v.anatomy_score,
        defects: v.defects.slice(0, 6), model: v.model ?? null,
        checked_at: v.measured_at,
      };
      batchResults.push({ page: a.page_number, pass: v.pass, degraded: v.degraded, score: v.anatomy_score, defects: v.defects });
    } catch (e) {
      verdictPatch = { pass: false, degraded: true, score: 0, defects: [`repair_fetch_fail:${String(e?.message ?? e).slice(0, 80)}`], checked_at: new Date().toISOString() };
      batchResults.push({ page: a.page_number, pass: false, degraded: true, score: 0, defects: verdictPatch.defects });
    }
    const nextMeta = { ...(a.meta ?? {}), repair_verdict: verdictPatch };
    await c.from("coloring_v2_assets").update({ meta: nextMeta }).eq("id", a.id);
  }

  const remaining = unchecked.length - batch.length;
  if (remaining > 0) {
    return json({
      ok: true, finalized: false,
      total_kept: keep.length, checked_before: checked.length,
      checked_this_run: batch.length, remaining,
      batch_results: batchResults,
    });
  }

  // ── Finalize: every interior has a verdict ────────────────────────────
  // Re-load with verdicts merged so we act on the full picture.
  const { data: finalRows } = await c.from("coloring_v2_assets")
    .select("id, page_number, storage_path, meta")
    .eq("book_id", book_id).eq("kind", "interior");
  const latestByPage = new Map<number, any>();
  for (const a of finalRows ?? []) {
    if (!latestByPage.has(a.page_number)) latestByPage.set(a.page_number, a);
  }

  const failIds: string[] = []; const failPaths: string[] = [];
  const failedPages: Array<{ p: number; defects: string[]; score: number }> = [];
  const passedPages: number[] = [];
  for (const a of latestByPage.values()) {
    const v = a.meta?.repair_verdict;
    // A page is considered "bad" only when the verifier ran AND rejected it.
    // Degraded verdicts (verifier outage) are LEFT AS-IS so we don't burn
    // credits regenerating pages that are probably fine.
    if (v && v.pass === false && v.degraded !== true) {
      failIds.push(a.id); failPaths.push(a.storage_path);
      failedPages.push({ p: a.page_number, defects: v.defects ?? [], score: v.score ?? 0 });
    } else {
      passedPages.push(a.page_number);
    }
  }

  // Cover assets — drop so cover regenerates fresh with the latest prompt.
  const { data: coverAssets } = await c.from("coloring_v2_assets")
    .select("id, storage_path")
    .eq("book_id", book_id)
    .in("kind", ["cover_final", "cover_illustration_layer", "cover_typography_layer"]);
  const coverIds = (coverAssets ?? []).map((a) => a.id);
  const coverPaths = (coverAssets ?? []).map((a) => a.storage_path);

  const allDelIds = [...dupIds, ...failIds, ...coverIds];
  const allDelPaths = [...dupPaths, ...failPaths, ...coverPaths];
  if (allDelPaths.length) {
    try { await c.storage.from("coloring-v2").remove(allDelPaths); } catch (_) { /* best-effort */ }
  }
  if (allDelIds.length) {
    await c.from("coloring_v2_assets").delete().in("id", allDelIds);
  }

  await c.from("coloring_v2_books").update({
    approved_cover_asset_id: null,
    stage: "interior_render",
    stage_updated_at: new Date().toISOString(),
    stage_attempt_count: 0,
    last_error: null,
    generation_status: "running",
  }).eq("id", book_id);

  const passedSet = new Set(passedPages);
  const missing: number[] = [];
  for (let p = 1; p <= (book.page_count ?? 0); p++) if (!passedSet.has(p)) missing.push(p);
  const firstPage = missing[0] ?? 1;
  await fireStage("coloring-v2-render-page", { book_id, page_number: firstPage });

  return json({
    ok: true, finalized: true,
    interior_total: keep.length,
    duplicates_dropped: dupIds.length,
    failed_dropped: failedPages.length,
    failed_pages: failedPages,
    cover_dropped: coverIds.length,
    missing_pages_to_render: missing,
    next_page_fired: firstPage,
  });
});
