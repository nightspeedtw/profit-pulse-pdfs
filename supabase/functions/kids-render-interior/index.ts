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
  type ScenePlan,
  type SceneRecord,
} from "../_shared/kids-interior.ts";
import { hardenCharacterDescription } from "../_shared/character-anti-confusion.ts";
import { runKidsVisionQcBatched } from "../_shared/kids-vision-qc.ts";
import { loadSegments, segmentsToScenePlan } from "../_shared/kids-segments.ts";
import { assertCoverOrInteriorReady, logStageEvidence, resolveStageOrThrow, loadCharacterLock } from "../_shared/skill-evidence.ts";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function patchInteriorBuild(db: ReturnType<typeof createClient>, ebookId: string, patch: Record<string, unknown>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db.from("ebooks_kids") as any).select("qc_scorecard").eq("id", ebookId).single();
    const qc = (data?.qc_scorecard ?? {}) as Record<string, unknown>;
    const ib = (qc.interior_build as Record<string, unknown> | undefined) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from("ebooks_kids") as any).update({
      qc_scorecard: { ...qc, interior_build: { ...ib, ...patch } },
    }).eq("id", ebookId);
  } catch (e) {
    console.warn("patchInteriorBuild failed", (e as Error).message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function patchPdfHandoff(db: ReturnType<typeof createClient>, ebookId: string, patch: Record<string, unknown>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db.from("ebooks_kids") as any).select("qc_scorecard").eq("id", ebookId).single();
    const qc = (data?.qc_scorecard ?? {}) as Record<string, unknown>;
    const h = (qc.pdf_handoff as Record<string, unknown> | undefined) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from("ebooks_kids") as any).update({
      pipeline_status: 'pdf_building',
      qc_scorecard: { ...qc, pdf_handoff: { ...h, ...patch } },
    }).eq("id", ebookId);
  } catch (e) {
    console.warn("patchPdfHandoff failed", (e as Error).message);
  }
}

// Double-tap self-invoke: fire → wait 5s → if child didn't ack, fire again.
function selfInvoke(db: ReturnType<typeof createClient>, ebookId: string, delayMs = 200) {
  const dispatchedAt = new Date().toISOString();
  const dispatchOnce = async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/kids-render-interior`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id: ebookId, chained: true, dispatched_at: dispatchedAt }),
      });
    } catch (e) {
      console.error("self-invoke failed", (e as Error).message);
    }
  };

  const task = (async () => {
    await patchInteriorBuild(db, ebookId, { next_dispatched_at: dispatchedAt });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await dispatchOnce();
    // Ack check
    await new Promise((r) => setTimeout(r, 5000));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (db.from("ebooks_kids") as any).select("qc_scorecard").eq("id", ebookId).single();
      const qc = (data?.qc_scorecard ?? {}) as Record<string, unknown>;
      const ib = (qc.interior_build as Record<string, unknown> | undefined) ?? {};
      const acked = (ib.acked_at as string | undefined) ?? '';
      if (!acked || acked < dispatchedAt) {
        console.warn(`[render-interior] chain ack missing after 5s (acked=${acked}, dispatched=${dispatchedAt}); double-tapping ebook=${ebookId}`);
        await dispatchOnce();
      }
    } catch (e) {
      console.warn("double-tap ack check failed", (e as Error).message);
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

async function handoffToPdfPrepare(db: ReturnType<typeof createClient>, ebookId: string) {
  const dispatchedAt = new Date().toISOString();
  await patchPdfHandoff(db, ebookId, {
    fired_at: dispatchedAt,
    next_dispatched_at: dispatchedAt,
    target_stage: 'pdf_prepare',
    source: 'kids-render-interior.complete',
  });

  const dispatchOnce = async () => {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/kids-build-picture-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id: ebookId, stage: 'pdf_prepare', publish: true, run_qc_after: false, dispatched_at: dispatchedAt }),
      });
      const text = await r.text().catch(() => '');
      console.log("pdf prepare handoff", JSON.stringify({ ebook_id: ebookId, status: r.status, body: text.slice(0, 240) }));
    } catch (e) {
      console.error("pdf prepare handoff failed", (e as Error).message);
    }
  };

  const task = (async () => {
    await dispatchOnce();
    await new Promise((r) => setTimeout(r, 5000));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (db.from("ebooks_kids") as any).select("qc_scorecard").eq("id", ebookId).single();
      const qc = (data?.qc_scorecard ?? {}) as Record<string, unknown>;
      const h = (qc.pdf_handoff as Record<string, unknown> | undefined) ?? {};
      const acked = (h.acked_at as string | undefined) ?? '';
      if (!acked || acked < dispatchedAt) {
        console.warn(`[render-interior] pdf handoff not acked in 5s; double-tapping ebook=${ebookId}`);
        await dispatchOnce();
      }
    } catch (e) {
      console.warn("pdf handoff ack check failed", (e as Error).message);
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
    .select("id, title, manuscript_md, cover_url, interior_illustrations, qc_scorecard, style_bible_json, storefront_meta")
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

  const baseCharDescription = [
    cb.name && `named ${cb.name}`,
    cb.species && `(${cb.species})`,
    cb.hair && `${cb.hair} hair`,
    cb.eyes && `${cb.eyes} eyes`,
    cb.skin && `${cb.skin} skin`,
    cb.outfit && `wearing ${cb.outfit}`,
    cb.accessory && `with ${cb.accessory}`,
  ].filter(Boolean).join(", ") || "the story hero";

  // Auto-inject species-derived anti-confusion clause (e.g. "dust bunny is NOT
  // a rabbit"). This is the root fix for the Detective Dot rabbit drift.
  const characterDescription = hardenCharacterDescription(baseCharDescription, cb.species);

  return { ebook, characterDescription, styleSuffix, negativePrompt };
}

async function ensureScenePlan(
  db: ReturnType<typeof createClient>,
  ebookId: string,
  ebook: { title?: string; manuscript_md?: string; qc_scorecard?: Record<string, unknown> | null; storefront_meta?: Record<string, unknown> | null },
  minScenes: number,
): Promise<ScenePlan> {
  const qc = (ebook.qc_scorecard ?? {}) as Record<string, unknown>;
  const persisted = qc.scene_plan as ScenePlan | undefined;
  if (persisted && Array.isArray(persisted.scenes) && persisted.scenes.length >= MIN_TOTAL) {
    return persisted;
  }

  // Prefer structured segments (KILLER 2). Derive scene plan 1:1 — no splitter.
  const segs = loadSegments(ebook as Record<string, unknown>);
  if (segs && segs.pages.length >= MIN_TOTAL) {
    const plan = segmentsToScenePlan(segs);
    console.log(`[render-interior] derived scene plan 1:1 from ${segs.pages.length} segments`);
    const nextQc = { ...qc, scene_plan: plan, scene_plan_source: 'segments' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from("ebooks_kids") as any).update({ qc_scorecard: nextQc }).eq("id", ebookId);
    return plan;
  }

  console.log("[render-interior] building scene plan via legacy splitter (no segments)");
  const plan = await buildScenePlan({
    title: String(ebook.title ?? ""),
    manuscript_md: String(ebook.manuscript_md ?? ""),
    min_scenes: minScenes,
  });
  const nextQc = { ...qc, scene_plan: plan, scene_plan_source: 'splitter' };
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
        // Gate 3: set the book's style anchor from the first written page. All
        // future pages must match this fingerprint or they get regenerated.
        const anchor = (qc.style_anchor_fingerprint as string | undefined) ?? rec.style_fingerprint ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db.from("ebooks_kids") as any).update({
          interior_illustrations: arr,
          qc_scorecard: { ...qc, interior_build, style_anchor_fingerprint: anchor },
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

  let body: { ebook_id?: string; run_id?: string; chained?: boolean; dispatched_at?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const ebookId = body.ebook_id;
  if (!ebookId) return json({ error: "ebook_id required" }, 400);

  // Handoff ack: signal the dispatching parent that this child actually started
  // so its double-tap retry can skip. Fire-and-forget.
  if (body.chained) {
    void patchInteriorBuild(db, ebookId, { acked_at: new Date().toISOString() });
  }

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
      const legacyName = `page-${String(r.index).padStart(2, "0")}.png`;
      const recordedName = typeof (r as { path?: unknown }).path === 'string'
        ? String((r as { path: string }).path).split('/').pop()
        : null;
      if ((recordedName && storagePaths.has(recordedName)) || storagePaths.has(legacyName)) {
        doneIdx.add(r.index - 1);
      }
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

      // ---- VERIFY-AS-YOU-GO: batched vision QC on the just-rendered pages ----
      // Any page that scores below the character/cover threshold gets one
      // in-place regenerate attempt (attempt=1) with a stronger nudge, tracked
      // in qc_scorecard.page_regen_attempts so we cap at 2 retries per page and
      // never re-verify the same page infinitely.
      try {
        if (cover) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: fresh1 } = await (db.from("ebooks_kids") as any)
            .select("interior_illustrations, qc_scorecard")
            .eq("id", ebookId).single();
          const arr: SceneRecord[] = Array.isArray(fresh1?.interior_illustrations)
            ? (fresh1.interior_illustrations as SceneRecord[]) : [];
          const justRendered = arr.filter((r) => batch.includes(r.index - 1));
          if (justRendered.length > 0) {
            const verdicts = await runKidsVisionQcBatched({
              coverUrl: cover,
              interior: justRendered.map((r) => ({
                index: r.index, page_number: r.page_number, url: r.url, scene: r.scene, hash: r.hash,
              })),
              ebook_id: ebookId,
            });
            const qc1 = (fresh1?.qc_scorecard ?? {}) as Record<string, unknown>;
            const attemptsMap = { ...((qc1.page_regen_attempts as Record<string, number>) ?? {}) };
            const failingIdx: number[] = [];
            for (const v of verdicts) {
              const bad = v.character_match_score < 78 || v.cover_interior_match_score < 75;
              const key = String(v.index);
              const prev = attemptsMap[key] ?? 0;
              if (bad && prev < 2) {
                failingIdx.push(v.index - 1);
                attemptsMap[key] = prev + 1;
              }
            }
            // Persist attempts + verdicts for observability.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (db.from("ebooks_kids") as any).update({
              qc_scorecard: {
                ...qc1,
                page_regen_attempts: attemptsMap,
                last_batch_verdicts: { at: new Date().toISOString(), verdicts: verdicts.slice(0, 32) },
              },
            }).eq("id", ebookId);
            if (failingIdx.length > 0) {
              console.log(`[render-interior] verify-as-you-go regenerating ${failingIdx.length} off-model pages: ${failingIdx.map((i) => i + 1).join(",")}`);
              await runBatch(failingIdx, async (i) => {
                const rec = await renderAndUploadOne({
                  ebookId, db,
                  scene: plan.scenes[i], sceneIndex: i, startPageNumber: START_PAGE,
                  characterDescription, styleSuffix, negativePrompt,
                  coverReferenceUrl: cover, extraReferenceUrls: [],
                  attempt: attemptsMap[String(i + 1)] ?? 1,
                  step: "kids_interior_verify_regen",
                });
                await writer(rec);
              });
            }
          }
        }
      } catch (e) {
        console.warn("[render-interior] verify-as-you-go failed (non-fatal):", (e as Error).message);
      }

      const remaining = missing.length - batch.length;
      if (remaining > 0) {
        console.log(`[render-interior] ${remaining} pages remain — self-chaining`);
        selfInvoke(db, ebookId);
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
            await writer(rec);
          } catch (e) {
            console.warn(`reroll page ${i + 1} failed`, (e as Error).message);
          }
        }
        if (dupIdx.length > batch.length) {
          selfInvoke(db, ebookId);
          return json({
            ok: true, stage: "dedupe", total, dup_remaining: dupIdx.length - batch.length,
            duration_ms: Date.now() - startedAt,
          }, 202);
        }
      }
    }

    // ---- All done — hand off to PDF assembly + parent autopilot run ----
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completedAt = new Date().toISOString();
    await (db.from("ebooks_kids") as any).update({
      pipeline_status: "pdf_building",
      qc_scorecard: { ...(ebook.qc_scorecard ?? {}), interior_build: { done: records.length, total, updated_at: completedAt, complete: true } },
    }).eq("id", ebookId);

    // Skill-usage evidence for generate_interior — one row per required
    // contract (character_reference, illustration_style_lock, page_plan,
    // text_image_semantic_match, image_artifact_guard). Character lock is
    // re-asserted here so a rewritten reference cannot slip through.
    try {
      const lock = await assertCoverOrInteriorReady(ebookId, "generate_interior", db);
      const interiorContracts = await resolveStageOrThrow("generate_interior");
      await logStageEvidence(interiorContracts, {
        run_id: parentRunId ?? null,
        book_id: ebookId,
        input_reference_ids: [lock.story_bible_id, lock.character_bible_id,
          lock.character_reference_id, lock.style_version].filter(Boolean) as string[],
        output_asset_ids: records.map((r) => r.path ?? r.url ?? "").filter(Boolean).slice(0, 40),
        pass_fail_result: "pass",
      });
    } catch (e) {
      console.warn("[render-interior] skill evidence failed", (e as Error).message);
    }

    console.log(`[render-interior] complete ebook=${ebookId} total=${records.length}. Handoff pdf_prepare + resuming parent run=${parentRunId}`);
    await handoffToPdfPrepare(db, ebookId);
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
