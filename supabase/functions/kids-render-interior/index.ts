// Staged, resumable interior illustration renderer.
//
// Problem this solves: a single edge invocation cannot render all 28+ pages
// (each ~20-30s) inside the worker wall-clock. Previously the whole batch
// died mid-way with zero incremental persistence, so every watchdog resume
// restarted from scratch — burning image credits repeatedly.
//
// This function:
//   1. Loads the persisted scene plan from qc_scorecard.scene_plan (built
//      once by the autopilot pipeline). If missing, builds and persists it.
//   2. Computes MISSING page indices by intersecting existing
//      interior_illustrations records with storage listing under
//      kids/{ebook_id}/interior/.
//   3. Generates up to BATCH_SIZE (8) pages per invocation with concurrency 3.
//   4. After EACH page: uploads to storage + appends a SceneRecord to
//      ebooks_kids.interior_illustrations (serialized read-modify-write) +
//      updates qc_scorecard.interior_build progress marker.
//   5. If pages still remain → fire-and-forget self-invoke with the same
//      ebook_id and returns 202.
//   6. When all pages are done → runs a bounded dedupe reroll pass (also
//      capped per invocation), then resumes the parent autopilot run via
//      autopilot-kids-pipeline force_finish so thumbnail/previews/PDF steps
//      run automatically.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildScenePlan,
  renderAndUploadOne,
  sha256Hex,
  type ScenePlan,
  type SceneRecord,
} from "../_shared/kids-interior.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH_SIZE = 8;
const CONCURRENCY = 3;
const DEDUPE_BATCH = 4;   // max reroll attempts per invocation
const START_PAGE = 3;     // page number offset (cover=1, blank/title=2)
const MIN_TOTAL = 12;     // hard minimum accepted (matches autopilot gate)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function selfInvoke(ebookId: string, delayMs = 200) {
  // Fire-and-forget continuation. Small delay lets the current response flush.
  const task = (async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/kids-render-interior`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id: ebookId, chained: true }),
      });
    } catch (e) {
      console.error("self-invoke failed", (e as Error).message);
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task); else void task;
}

async function resumeParentRun(runId: string | null | undefined) {
  if (!runId) return;
  const task = (async () => {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/autopilot-kids-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ run_id: runId, force_finish: true }),
      });
      console.log("resumed parent run", runId, r.status);
    } catch (e) {
      console.error("resume parent failed", (e as Error).message);
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task); else void task;
}

async function listStoragePaths(db: ReturnType<typeof createClient>, ebookId: string): Promise<Set<string>> {
  const seen = new Set<string>();
  try {
    // deno-lint-ignore no-explicit-any
    const { data } = await (db.storage.from("ebook-covers") as any).list(`kids/${ebookId}/interior`, { limit: 200 });
    for (const f of data ?? []) if (f?.name) seen.add(f.name);
  } catch (e) {
    console.warn("storage list failed", (e as Error).message);
  }
  return seen;
}

async function loadContext(db: ReturnType<typeof createClient>, ebookId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ebook } = await (db.from("ebooks_kids") as any)
    .select("id, title, manuscript_md, cover_url, interior_illustrations, qc_scorecard, style_bible_json")
    .eq("id", ebookId).single();
  if (!ebook) throw new Error(`ebook ${ebookId} not found`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bible } = await (db.from("kids_book_bibles") as any)
    .select("*").eq("ebook_id", ebookId).maybeSingle();
  if (!bible) throw new Error("no kids_book_bible — cover step must run first");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stylePreset } = await (db.from("kids_style_presets") as any)
    .select("prompt_suffix, negative_prompt")
    .eq("slug", (bible.style_slug as string | null) ?? "").maybeSingle();

  const cb = (bible.character_bible_json ?? {}) as Record<string, string>;
  const sb = (bible.style_bible_json ?? ebook.style_bible_json ?? {}) as Record<string, unknown>;

  const styleSuffix = [
    stylePreset?.prompt_suffix as string | undefined,
    sb.line_quality && `line quality: ${sb.line_quality}`,
    sb.lighting && `lighting: ${sb.lighting}`,
    sb.mood && `mood: ${sb.mood}`,
    sb.medium && `medium: ${sb.medium}`,
    Array.isArray(sb.palette) && (sb.palette as string[]).length ? `palette: ${(sb.palette as string[]).join(", ")}` : null,
  ].filter(Boolean).join("; ") || "warm whimsical storybook illustration, cozy painterly, soft edges";

  const negativePrompt = (stylePreset?.negative_prompt as string | undefined)
    ?? "text, watermark, scary, photorealistic";

  const characterDescription = [
    cb.name && `named ${cb.name}`,
    cb.species && `(${cb.species})`,
    cb.hair && `${cb.hair} hair`,
    cb.eyes && `${cb.eyes} eyes`,
    cb.skin && `${cb.skin} skin`,
    cb.outfit && `wearing ${cb.outfit}`,
    cb.accessory && `with ${cb.accessory}`,
  ].filter(Boolean).join(", ") || "the story hero";

  return { ebook, characterDescription, styleSuffix, negativePrompt };
}

async function ensureScenePlan(
  db: ReturnType<typeof createClient>,
  ebookId: string,
  ebook: { title?: string; manuscript_md?: string; qc_scorecard?: Record<string, unknown> | null },
  minScenes: number,
): Promise<ScenePlan> {
  const qc = (ebook.qc_scorecard ?? {}) as Record<string, unknown>;
  const persisted = qc.scene_plan as ScenePlan | undefined;
  if (persisted && Array.isArray(persisted.scenes) && persisted.scenes.length >= MIN_TOTAL) {
    return persisted;
  }
  console.log("[render-interior] building scene plan (first time)");
  const plan = await buildScenePlan({
    title: String(ebook.title ?? ""),
    manuscript_md: String(ebook.manuscript_md ?? ""),
    min_scenes: minScenes,
  });
  const nextQc = { ...qc, scene_plan: plan };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.from("ebooks_kids") as any).update({ qc_scorecard: nextQc }).eq("id", ebookId);
  return plan;
}

// Serialized read-modify-write of the interior_illustrations jsonb column.
// Concurrent workers append via a promise chain (mutex) so we never lose
// a record to a lost write.
function makeWriter(db: ReturnType<typeof createClient>, ebookId: string, total: number) {
  let chain: Promise<void> = Promise.resolve();
  return function writeRecord(rec: SceneRecord): Promise<void> {
    chain = chain.then(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: cur } = await (db.from("ebooks_kids") as any)
          .select("interior_illustrations, qc_scorecard")
          .eq("id", ebookId).single();
        const arr: SceneRecord[] = Array.isArray(cur?.interior_illustrations)
          ? [...(cur.interior_illustrations as SceneRecord[])]
          : [];
        // upsert by page index
        const existingIdx = arr.findIndex((r) => r.index === rec.index);
        if (existingIdx >= 0) arr[existingIdx] = rec; else arr.push(rec);
        arr.sort((a, b) => a.index - b.index);
        const qc = (cur?.qc_scorecard ?? {}) as Record<string, unknown>;
        const interior_build = { done: arr.length, total, updated_at: new Date().toISOString() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db.from("ebooks_kids") as any).update({
          interior_illustrations: arr,
          qc_scorecard: { ...qc, interior_build },
        }).eq("id", ebookId);
      } catch (e) {
        console.error("writeRecord failed page", rec.index, (e as Error).message);
      }
    });
    return chain;
  };
}

async function runBatch(indices: number[], workerFn: (i: number) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (true) {
      const k = cursor++;
      if (k >= indices.length) return;
      const i = indices[k];
      try {
        await workerFn(i);
      } catch (e) {
        console.error(`worker page ${i + 1} failed`, (e as Error).message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indices.length) }, () => worker()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { ebook_id?: string; run_id?: string; chained?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const ebookId = body.ebook_id;
  if (!ebookId) return json({ error: "ebook_id required" }, 400);

  try {
    const { ebook, characterDescription, styleSuffix, negativePrompt } = await loadContext(db, ebookId);

    // Discover parent run_id if not provided (so we can resume when done).
    let parentRunId = body.run_id ?? null;
    if (!parentRunId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: runs } = await (db.from("autopilot_kids_runs") as any)
        .select("id, status, updated_at")
        .eq("ebook_kids_id", ebookId)
        .order("updated_at", { ascending: false })
        .limit(1);
      parentRunId = runs?.[0]?.id ?? null;
    }

    const plan = await ensureScenePlan(db, ebookId, ebook, Math.max(MIN_TOTAL, 28));
    const total = plan.scenes.length;

    const existing: SceneRecord[] = Array.isArray(ebook.interior_illustrations)
      ? (ebook.interior_illustrations as SceneRecord[])
      : [];
    const storagePaths = await listStoragePaths(db, ebookId);
    const doneIdx = new Set<number>();
    for (const r of existing) {
      const fname = `page-${String(r.index).padStart(2, "0")}.png`;
      if (storagePaths.has(fname)) doneIdx.add(r.index - 1);
    }

    const missing: number[] = [];
    for (let i = 0; i < total; i++) if (!doneIdx.has(i)) missing.push(i);

    console.log(`[render-interior] ebook=${ebookId} total=${total} done=${doneIdx.size} missing=${missing.length}`);

    const writer = makeWriter(db, ebookId, total);

    if (missing.length > 0) {
      const batch = missing.slice(0, BATCH_SIZE);
      const cover = ebook.cover_url as string | null;
      await runBatch(batch, async (i) => {
        const rec = await renderAndUploadOne({
          ebookId,
          db,
          scene: plan.scenes[i],
          sceneIndex: i,
          startPageNumber: START_PAGE,
          characterDescription,
          styleSuffix,
          negativePrompt,
          coverReferenceUrl: cover,
          extraReferenceUrls: [],
          attempt: 0,
          step: "kids_interior_page",
        });
        await writer(rec);
      });

      const remaining = missing.length - batch.length;
      if (remaining > 0) {
        console.log(`[render-interior] ${remaining} pages remain — self-chaining`);
        selfInvoke(ebookId);
        return json({
          ok: true,
          stage: "batch",
          done: doneIdx.size + batch.length,
          total,
          rendered_this_call: batch.length,
          remaining,
          duration_ms: Date.now() - startedAt,
        }, 202);
      }
      // else — batch drained the missing list; fall through to dedupe/finish.
    }

    // ---- Dedupe pass (only when full set exists) ----
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fresh } = await (db.from("ebooks_kids") as any)
      .select("interior_illustrations, cover_url")
      .eq("id", ebookId).single();
    const records: SceneRecord[] = Array.isArray(fresh?.interior_illustrations)
      ? [...(fresh.interior_illustrations as SceneRecord[])]
      : [];

    if (records.length >= total) {
      const byHash: Record<string, number[]> = {};
      for (const r of records) (byHash[r.hash] ??= []).push(r.index - 1);
      const dupIdx: number[] = [];
      for (const idxs of Object.values(byHash)) {
        if (idxs.length > 1) for (const i of idxs.slice(1)) dupIdx.push(i);
      }
      if (dupIdx.length > 0) {
        const batch = dupIdx.slice(0, DEDUPE_BATCH);
        console.log(`[render-interior] dedupe rerolling ${batch.length} of ${dupIdx.length} dup pages`);
        const cover = fresh?.cover_url as string | null;
        for (const i of batch) {
          try {
            const rec = await renderAndUploadOne({
              ebookId,
              db,
              scene: plan.scenes[i],
              sceneIndex: i,
              startPageNumber: START_PAGE,
              characterDescription,
              styleSuffix,
              negativePrompt,
              coverReferenceUrl: cover,
              attempt: 1,
              step: "kids_interior_reroll",
            });
            const h = await sha256Hex(new Uint8Array()); // placeholder, hash already computed inside
            void h;
            await writer(rec);
          } catch (e) {
            console.warn(`reroll page ${i + 1} failed`, (e as Error).message);
          }
        }
        if (dupIdx.length > batch.length) {
          selfInvoke(ebookId);
          return json({
            ok: true, stage: "dedupe", total, dup_remaining: dupIdx.length - batch.length,
            duration_ms: Date.now() - startedAt,
          }, 202);
        }
      }
    }

    // ---- All done — hand off to parent autopilot run ----
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from("ebooks_kids") as any).update({
      pipeline_status: "illustrating",
      qc_scorecard: { ...(ebook.qc_scorecard ?? {}), interior_build: { done: records.length, total, updated_at: new Date().toISOString(), complete: true } },
    }).eq("id", ebookId);

    console.log(`[render-interior] complete ebook=${ebookId} total=${records.length}. Resuming parent run=${parentRunId}`);
    if (parentRunId) resumeParentRun(parentRunId);

    return json({
      ok: true, stage: "complete", done: records.length, total,
      resumed_parent_run: parentRunId, duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("[render-interior] fatal", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
