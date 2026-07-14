// kids-regenerate-offmodel-pages
//
// TARGETED repair strategy for character consistency failures.
//
// Root problem this solves: when vision QC flags a subset of interior pages
// with low character_match_score (e.g. 6/28 pages drew a rabbit instead of a
// dust bunny), previous repair strategies (kids-global-style-fallback)
// regenerated EVERY interior + cover, wasting 20+ image credits and often
// making things worse. This function regenerates ONLY the flagged pages, and
// it pins the TOP-SCORING interior pages (character_match >= 90) as reference
// images so the model has direct visual anchors of the correct character.
//
// After successful regeneration it wipes the in-progress PDF + pdf_repair_job
// so kids-build-picture-pdf rebuilds cleanly, then chains QC + publish.
//
// Retries:
//   Each flagged page gets up to 3 attempts (initial + 2 retries). Every
//   retry escalates the anti-confusion clause and pins additional reference
//   images. A page is accepted as soon as it renders successfully (bytes
//   returned); vision re-scoring happens in the next full kids-qc-run.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderAndUploadOne, type SceneRecord } from "../_shared/kids-interior.ts";
import { hardenCharacterDescription, antiConfusionClause } from "../_shared/character-anti-confusion.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const START_PAGE = 3;
const CHAR_SCORE_THRESHOLD = 80;      // below → regenerate
const REF_SCORE_THRESHOLD = 90;       // at/above → eligible as reference
const MAX_REFS = 4;                    // cover + up to 4 pinned pages
const MAX_ATTEMPTS_PER_PAGE = 3;
const BATCH_SIZE = 6;                  // pages regenerated per invocation
const CONCURRENCY = 2;                 // parallel gen within a batch

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface VisionPage {
  page_number: number;
  index?: number;
  url: string;
  character_match_score: number;
  protagonist_face_body_score?: number;
}

// Escalating clause per retry attempt (stronger negative each pass).
function escalatedClause(species: string | null | undefined, attempt: number): string {
  const base = antiConfusionClause(species);
  if (attempt === 0) return base;
  const boost = attempt === 1
    ? " CRITICAL: earlier renders drew the wrong species; do NOT repeat that mistake."
    : " FINAL CHANCE: previous attempts drew the wrong animal (a rabbit / a bunny / an incorrect species). Draw ONLY the described amorphous fluff creature — no ears, no cottontail, no rabbit anatomy of any kind.";
  return `${base}${boost}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: {
    ebook_id?: string;
    run_id?: string;
    publish?: boolean;
    page_numbers?: number[];   // optional explicit override
    chained?: boolean;          // self-invocation flag
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const ebookId = body.ebook_id;
  if (!ebookId) return json({ ok: false, error: "ebook_id required" }, 400);
  const publish = body.publish !== false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ebook, error } = await (db.from("ebooks_kids") as any)
      .select("id, title, cover_url, interior_illustrations, qc_scorecard, style_bible_json")
      .eq("id", ebookId).single();
    if (error || !ebook) return json({ ok: false, error: "ebook not found" }, 404);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (db.from("kids_book_bibles") as any)
      .select("character_bible_json, style_bible_json, style_slug")
      .eq("ebook_id", ebookId).maybeSingle();
    if (!bible) return json({ ok: false, error: "no kids_book_bible" }, 400);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: preset } = await (db.from("kids_style_presets") as any)
      .select("prompt_suffix, negative_prompt")
      .eq("slug", bible.style_slug ?? "").maybeSingle();

    const cb = (bible.character_bible_json ?? {}) as Record<string, string>;
    const sb = (bible.style_bible_json ?? ebook.style_bible_json ?? {}) as Record<string, unknown>;

    const styleSuffix = [
      preset?.prompt_suffix as string | undefined,
      sb.line_quality && `line quality: ${sb.line_quality}`,
      sb.lighting && `lighting: ${sb.lighting}`,
      sb.mood && `mood: ${sb.mood}`,
      sb.medium && `medium: ${sb.medium}`,
      Array.isArray(sb.palette) && (sb.palette as string[]).length
        ? `palette: ${(sb.palette as string[]).join(", ")}` : null,
    ].filter(Boolean).join("; ") || "warm whimsical storybook illustration, cozy painterly, soft edges";

    const negativePrompt = (preset?.negative_prompt as string | undefined)
      ?? "text, watermark, scary, photorealistic";

    const baseChar = [
      cb.name && `named ${cb.name}`,
      cb.species && `(${cb.species})`,
      cb.hair && `${cb.hair} hair`,
      cb.eyes && `${cb.eyes} eyes`,
      cb.skin && `${cb.skin} skin`,
      cb.outfit && `wearing ${cb.outfit}`,
      cb.accessory && `with ${cb.accessory}`,
    ].filter(Boolean).join(", ") || "the story hero";

    // Vision report — required ONLY when caller does not pass an explicit
    // page_numbers list. For deterministic gate repairs (dead_page_gate at
    // assembly time), pdf builder passes the exact page(s) and there is no
    // vision report yet — skip that requirement and use whatever top refs we
    // can gather from any existing vision data.
    const scorecard = (ebook.qc_scorecard ?? {}) as Record<string, unknown>;
    const vision = scorecard.vision_report as { pages?: VisionPage[] } | undefined;
    const visionPages = Array.isArray(vision?.pages) ? vision!.pages : [];
    const explicitPages = Array.isArray(body.page_numbers) && body.page_numbers.length > 0;
    if (visionPages.length === 0 && !explicitPages) {
      return json({ ok: false, error: "no vision_report.pages — run kids-qc-run first" }, 400);
    }

    // Interior records — page_number is our splice key.
    const interior: SceneRecord[] = Array.isArray(ebook.interior_illustrations)
      ? [...(ebook.interior_illustrations as SceneRecord[])]
      : [];
    const byPageNumber = new Map<number, SceneRecord>();
    for (const r of interior) byPageNumber.set(r.page_number, r);

    // Off-model pages: caller override wins; otherwise below-threshold vision pages.
    const flagged = new Set<number>(
      explicitPages
        ? body.page_numbers!
        : visionPages
            .filter((p) => Number(p.character_match_score ?? 100) < CHAR_SCORE_THRESHOLD)
            .map((p) => p.page_number),
    );

    // Top-scoring reference pages — best in-book examples of the correct
    // character. If no vision report yet, fall back to a sample of existing
    // interior URLs (skipping the flagged pages) so we still condition on the
    // in-book style.
    const topRefs = visionPages.length > 0
      ? visionPages
          .filter((p) => Number(p.character_match_score ?? 0) >= REF_SCORE_THRESHOLD && !flagged.has(p.page_number))
          .sort((a, b) => Number(b.character_match_score) - Number(a.character_match_score))
          .slice(0, MAX_REFS)
          .map((p) => p.url)
      : interior
          .filter((r) => !flagged.has(r.page_number) && r.url)
          .slice(0, MAX_REFS)
          .map((r) => r.url);

    const cover = ebook.cover_url as string | null;
    // Pin cover FIRST (character bible template), then top-scoring interior pages.
    const referenceUrls: string[] = [];
    if (cover) referenceUrls.push(cover);
    referenceUrls.push(...topRefs);
    // Keep list bounded to avoid over-conditioning + gateway payload bloat.
    const finalRefs = referenceUrls.slice(0, MAX_REFS + 1);

    console.log(`[regen-offmodel] ebook=${ebookId} flagged=${[...flagged].join(",")} refs=${finalRefs.length} (${topRefs.length} top-scoring pages)`);

    if (flagged.size === 0) {
      return json({ ok: true, skipped: true, reason: "no pages below threshold" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fresh } = await (db.from("ebooks_kids") as any)
      .select("qc_scorecard")
      .eq("id", ebookId).single();
    const freshQc = ((fresh?.qc_scorecard ?? {}) as Record<string, unknown>);
    const persistedPlan = (freshQc.scene_plan as { scenes: Array<{ scene: string; setting?: string; emotion?: string }> } | undefined);
    // Fallback: reconstruct scene list from existing interior_illustrations
    // (each record already has {scene, page_number}). Ordered by page_number.
    let scenes: Array<{ scene: string; setting: string; emotion: string }>;
    if (persistedPlan && Array.isArray(persistedPlan.scenes) && persistedPlan.scenes.length >= interior.length) {
      scenes = persistedPlan.scenes.map((s) => ({
        scene: s.scene, setting: s.setting ?? "storybook world", emotion: s.emotion ?? "warm",
      }));
    } else {
      const sorted = [...interior].sort((a, b) => a.page_number - b.page_number);
      scenes = sorted.map((r) => ({
        scene: r.scene ?? `Page ${r.page_number}`, setting: "storybook world", emotion: "warm",
      }));
      if (scenes.length === 0) {
        return json({ ok: false, error: "no interior_illustrations to derive scenes from" }, 400);
      }
    }
    const plan = { scenes };

    // Resumable progress marker. On the first call, initialize pending list
    // from `flagged`. On subsequent chained calls, read remaining pages from
    // qc_scorecard.regen_offmodel.pending.
    const existingProg = (freshQc.regen_offmodel as { pending?: number[]; done?: number[]; failed?: number[] } | undefined);
    let pending: number[];
    let done: number[] = existingProg?.done ?? [];
    let failed: number[] = existingProg?.failed ?? [];
    if (!body.chained || !existingProg?.pending) {
      pending = [...flagged].sort((a, b) => a - b);
      done = [];
      failed = [];
    } else {
      pending = existingProg.pending;
    }

    const batch = pending.slice(0, BATCH_SIZE);
    const remaining = pending.slice(BATCH_SIZE);

    // Regenerate BATCH pages in parallel (concurrency CONCURRENCY).
    async function regenOne(pageNumber: number): Promise<{ page_number: number; ok: boolean; error?: string }> {
      const sceneIndex = pageNumber - START_PAGE;
      if (sceneIndex < 0 || sceneIndex >= plan.scenes.length) {
        return { page_number: pageNumber, ok: false, error: "scene_index out of range" };
      }
      let attempt = 0;
      let lastErr: string | undefined;
      while (attempt < MAX_ATTEMPTS_PER_PAGE) {
        try {
          const hardened = hardenCharacterDescription(baseChar, cb.species) +
            (attempt > 0 ? " " + escalatedClause(cb.species, attempt) : "");
          const rec = await renderAndUploadOne({
            ebookId,
            db,
            scene: plan.scenes[sceneIndex],
            sceneIndex,
            startPageNumber: START_PAGE,
            characterDescription: hardened,
            styleSuffix,
            negativePrompt: `${negativePrompt}, rabbit, bunny, long ears, cottontail, hare, wrong species`,
            coverReferenceUrl: cover,
            extraReferenceUrls: finalRefs.filter((u) => u !== cover),
            attempt,
            step: "kids_regen_offmodel",
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: cur } = await (db.from("ebooks_kids") as any)
            .select("interior_illustrations").eq("id", ebookId).single();
          const arr: SceneRecord[] = Array.isArray(cur?.interior_illustrations)
            ? [...(cur.interior_illustrations as SceneRecord[])]
            : [];
          const existingIdx = arr.findIndex((r) => r.index === rec.index);
          if (existingIdx >= 0) arr[existingIdx] = rec; else arr.push(rec);
          arr.sort((a, b) => a.index - b.index);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db.from("ebooks_kids") as any)
            .update({ interior_illustrations: arr }).eq("id", ebookId);
          return { page_number: pageNumber, ok: true };
        } catch (e) {
          lastErr = (e as Error).message;
          console.warn(`[regen-offmodel] p${pageNumber} attempt ${attempt + 1} failed: ${lastErr}`);
        }
        attempt++;
      }
      return { page_number: pageNumber, ok: false, error: lastErr };
    }

    // Bounded-concurrency batch.
    let cursor = 0;
    const results: Array<{ page_number: number; ok: boolean; error?: string }> = new Array(batch.length);
    async function worker() {
      while (true) {
        const k = cursor++;
        if (k >= batch.length) return;
        results[k] = await regenOne(batch[k]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()));

    for (const r of results) {
      if (r.ok) done.push(r.page_number); else failed.push(r.page_number);
    }
    const successCount = results.filter((r) => r.ok).length;
    console.log(`[regen-offmodel] ebook=${ebookId} batch ok=${successCount}/${batch.length} remaining=${remaining.length}`);

    // Persist progress marker.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: q } = await (db.from("ebooks_kids") as any)
      .select("qc_scorecard").eq("id", ebookId).single();
    const qcN = ((q?.qc_scorecard ?? {}) as Record<string, unknown>);
    qcN.regen_offmodel = { pending: remaining, done, failed, updated_at: new Date().toISOString() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from("ebooks_kids") as any).update({ qc_scorecard: qcN }).eq("id", ebookId);

    if (remaining.length > 0) {
      // Self-chain — more pages to regenerate.
      const selfChain = (async () => {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/kids-regenerate-offmodel-pages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ ebook_id: ebookId, run_id: body.run_id, publish, chained: true }),
          });
        } catch (e) {
          console.error("[regen-offmodel] self-chain failed", (e as Error).message);
        }
      })();
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(selfChain); else void selfChain;
      return json({
        ok: true, stage: "batch", batch_ok: successCount, batch_size: batch.length,
        remaining: remaining.length, done_total: done.length, failed_total: failed.length,
      }, 202);
    }


    // Reset staged PDF job so kids-build-picture-pdf rebuilds cleanly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fresh2 } = await (db.from("ebooks_kids") as any)
      .select("qc_scorecard").eq("id", ebookId).single();
    const qc2 = ((fresh2?.qc_scorecard ?? {}) as Record<string, unknown>);
    const log2 = ((qc2.repair_log ?? {}) as Record<string, unknown>);
    delete log2.pdf_repair_job;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.from("ebooks_kids") as any).update({
      qc_scorecard: { ...qc2, repair_log: log2 },
    }).eq("id", ebookId);

    // Remove the stale in-progress PDF so the builder starts from prepare.
    try {
      await db.storage.from("ebook-pdfs").remove([`kids/${ebookId}/book-inprogress.pdf`]);
    } catch { /* ok if absent */ }

    // Chain: build PDF → QC → publish (fire-and-forget).
    const chain = (async () => {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/kids-build-picture-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ ebook_id: ebookId, stage: "pdf_prepare", publish, run_qc_after: true }),
        });
      } catch (e) {
        console.error("[regen-offmodel] chain dispatch failed", (e as Error).message);
      }
    })();
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(chain); else void chain;

    return json({
      ok: true,
      ebook_id: ebookId,
      flagged: [...flagged],
      results,
      references_used: finalRefs.length,
      pdf_rebuild_dispatched: true,
    });
  } catch (e) {
    console.error("[regen-offmodel] fatal", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
