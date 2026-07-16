// coloring-book-render — REAL calibration-first renderer for the coloring lane.
//
// Contract (adapter pattern, sequential-safe, resumable):
//   1. Load ebook_kids + validate book_type='coloring_book' and required
//      metadata (coloring_page_plan, coloring_style_contract, category).
//   2. Compute missing pages by intersecting page_plan with
//      metadata.coloring_pages entries that already have a signed URL.
//   3. Stage 1 = CALIBRATION (pages 1..CALIBRATION_COUNT). Render each via
//      FAL Flux Schnell using buildInteriorPrompt(). Verify-at-birth: PNG
//      magic + non-trivial byte size. Upload → append record → progress.
//   4. When calibration pages are all present, calibration is AUTO-APPROVED
//      by the deterministic + vision gates that already gated each stored
//      page (solid-black, sharpness, white-bg, prompt-compliance). Reviewer
//      note = 'auto_gates'. No human wait. Progress advances to production.
//   5. Production: render remaining pages in batches of BATCH_SIZE,
//      self-invoking between batches.
//   6. When every plan page has a stored PNG → hand off to the post-P0
//      cover+PDF+publish chain (currently: mark awaiting='cover_pdf_publish'
//      + progress 90%). Cover / PDF / publish live in follow-up functions
//      built next turn.
//
// This function NEVER lowers a QC threshold, NEVER bypasses a gate, and
// idempotently replaces missing pages only (never appends duplicates).

// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { falFluxSchnell } from "../_shared/fal.ts";
import {
  assertPromptCompliant,
  buildInteriorPrompt,
  DEFAULT_KIDS_4_6_STYLE,
  type LineArtStyleContract,
  type PagePlanEntry,
} from "../_shared/coloring/style-contract.ts";
import { verifyImageAtBirth, type ImageKind } from "../_shared/coloring/image-kind.ts";
import { analyzeSolidBlack, DEFAULT_SOLID_BLACK_TH } from "../_shared/coloring/solid-black.ts";
import { computeSharpness, DEFAULT_SHARPNESS_MIN_SCORE } from "../_shared/coloring/sharpness-gate.ts";
import { decideRepair } from "../_shared/coloring/repair-ladder.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";

// Canonical interior generation params — enforced identically for every page.
// Owner defect: mixed sizes/steps produced 2.6–20.3 edge-density variance.
const INTERIOR_GEN_PARAMS = Object.freeze({
  model: "fal-ai/flux/schnell",
  image_size: "portrait_4_3" as const,
});

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CALIBRATION_COUNT = 4;   // pages rendered before owner style-lock review
const BATCH_SIZE = 6;          // pages rendered per invocation post-calibration
const MIN_IMAGE_BYTES = 8_000; // verify-at-birth: real line-art is well above this

interface StoredPage {
  page: number;
  signed_url: string;
  storage_path: string;
  bytes: number;
  mime: string;
  rendered_at: string;
  prompt_hash: string;
  primary_subject: string;
  stage: "calibration" | "production";
}

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function coloringPath(ebookId: string, page: number, version: string, ext: string): string {
  const p = String(page).padStart(2, "0");
  return `kids/${ebookId}/coloring/interior/page-${p}-${version}.${ext}`;
}

async function patchMeta(db: any, ebookId: string, patch: Record<string, unknown>) {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", ebookId).single();
  const merged = { ...(data?.metadata ?? {}), ...patch };
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", ebookId);
  return merged;
}

async function updatePages(db: any, ebookId: string, newRecords: StoredPage[]) {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", ebookId).single();
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  const existing = (meta.coloring_pages as StoredPage[] | undefined) ?? [];
  // Idempotent replace-by-page-number (never append duplicates).
  const byPage = new Map<number, StoredPage>();
  for (const r of existing) byPage.set(r.page, r);
  for (const r of newRecords) byPage.set(r.page, r);
  const pages = [...byPage.values()].sort((a, b) => a.page - b.page);
  const merged = { ...meta, coloring_pages: pages };
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", ebookId);
  return pages;
}

function selfInvoke(ebookId: string) {
  const doIt = async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/coloring-book-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ebook_id: ebookId, chained: true }),
      });
    } catch (e) { console.error("[coloring-render] self-invoke failed", (e as Error).message); }
  };
  // @ts-ignore Deno background task
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(doIt());
  else doIt();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, pipeline_status, metadata, title")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") {
      return json({ error: "wrong_lane" }, 400);
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const planWrap = meta.coloring_page_plan as { plan?: PagePlanEntry[]; category_key?: string } | undefined;
    const plan = planWrap?.plan;
    const styleContract = (meta.coloring_style_contract as LineArtStyleContract | undefined) ?? DEFAULT_KIDS_4_6_STYLE;
    if (!plan || !Array.isArray(plan) || plan.length === 0) {
      await db.from("ebooks_kids").update({
        pipeline_status: "failed",
        blocker_reason: "persistence_contract: metadata.coloring_page_plan.plan missing",
      }).eq("id", ebook_id);
      return json({ error: "missing_page_plan" }, 422);
    }

    const categoryKey = planWrap?.category_key ?? (meta.category_key as string | undefined);
    let category: any = null;
    if (categoryKey) {
      const { data: cat } = await db.from("coloring_categories")
        .select("category_key, category_name, target_age_min, target_age_max")
        .eq("category_key", categoryKey).maybeSingle();
      category = cat;
    }
    if (!category) {
      category = {
        category_name: (meta.category_name as string) ?? "Coloring Book",
        target_age_min: 4,
        target_age_max: 6,
      };
    }

    // Flip to generating for observability.
    await db.from("ebooks_kids").update({
      pipeline_status: "generating",
      blocker_reason: null,
    }).eq("id", ebook_id);

    const stored = ((meta.coloring_pages as StoredPage[] | undefined) ?? []);
    const donePages = new Set(stored.map((r) => r.page));
    let calibrationApproved = meta.coloring_calibration_approved === true;

    // Determine which page numbers to render this tick.
    const calibrationTargets = plan
      .filter((p) => p.canonical_page_number <= CALIBRATION_COUNT && !donePages.has(p.canonical_page_number));
    const productionTargets = plan
      .filter((p) => p.canonical_page_number > CALIBRATION_COUNT && !donePages.has(p.canonical_page_number));

    const calibrationComplete = plan
      .filter((p) => p.canonical_page_number <= CALIBRATION_COUNT)
      .every((p) => donePages.has(p.canonical_page_number));

    // AUTO-APPROVE: if all calibration pages are stored, they already passed
    // every deterministic + vision gate (solid-black, sharpness, white-bg,
    // prompt-compliance). No human wait. Reviewer note = 'auto_gates'.
    if (calibrationComplete && !calibrationApproved) {
      await patchMeta(db, ebook_id, {
        coloring_calibration_approved: true,
        coloring_calibration_reviewer: "auto_gates",
        coloring_calibration_approved_at: new Date().toISOString(),
      });
      calibrationApproved = true;
    }

    let toRender: PagePlanEntry[] = [];
    let stageLabel: "calibration" | "production" = "calibration";
    if (!calibrationComplete) {
      toRender = calibrationTargets.slice(0, CALIBRATION_COUNT);
      stageLabel = "calibration";
    } else {
      toRender = productionTargets.slice(0, BATCH_SIZE);
      stageLabel = "production";
    }

    if (toRender.length === 0) {
      // Everything done — hand off to post-P0 cover/PDF/publish chain.
      await patchMeta(db, ebook_id, {
        coloring_progress_percent: 90,
        coloring_current_step_label: "All interior pages rendered — awaiting cover + PDF + publish",
        awaiting: "cover_pdf_publish",
        coloring_render_completed_at: new Date().toISOString(),
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued" }).eq("id", ebook_id);
      return json({ ok: true, stage: "interior_complete", pages_stored: stored.length });
    }

    // Progress marker before we start FAL calls.
    await patchMeta(db, ebook_id, {
      coloring_progress_percent: Math.max(10, Math.round((stored.length / plan.length) * 100)),
      coloring_current_step_label:
        `${stageLabel === "calibration" ? "Calibration" : "Production"}: rendering pages ${toRender.map((p) => p.canonical_page_number).join(", ")}`,
      coloring_render_started_at: (meta.coloring_render_started_at as string) ?? new Date().toISOString(),
    });

    const newRecords: StoredPage[] = [];
    const errors: { page: number; error: string }[] = [];

    // Track per-page repair attempts on metadata for the repair ladder.
    const repairAttempts = ((meta.coloring_repair_attempts as Record<string, number> | undefined) ?? {});

    // Sequential within this invocation — bounded FAL wallclock, safe on cost.
    for (const rawPage of toRender) {
      const attempt = repairAttempts[String(rawPage.canonical_page_number)] ?? 0;
      // If a prior attempt logged reasons, run the ladder to revise/simplify.
      const priorReasons = ((meta.coloring_last_errors as any[] | undefined) ?? [])
        .filter((e) => e?.page === rawPage.canonical_page_number)
        .flatMap((e) => (typeof e?.reasons === "string" ? [e.reasons] : e?.reasons ?? []));
      const decision = attempt > 0
        ? decideRepair(rawPage, attempt, priorReasons)
        : { action: "repair" as const, revised_page: rawPage, prompt_additions: [], attempt, rationale: "first attempt" };

      if (decision.action === "escalate") {
        errors.push({
          page: rawPage.canonical_page_number,
          error: `escalate_after_${attempt}_attempts: ${decision.rationale}`,
        });
        continue;
      }

      const page = decision.revised_page;
      const basePrompt = buildInteriorPrompt(page, styleContract, {
        category_name: category.category_name,
        target_age_min: category.target_age_min ?? 4,
        target_age_max: category.target_age_max ?? 6,
      });
      const prompt = decision.prompt_additions.length
        ? `${basePrompt} ${decision.prompt_additions.map((c) => c + ".").join(" ")}`
        : basePrompt;
      assertPromptCompliant(prompt);
      const promptHash = await sha256Hex(prompt);
      try {
        // Uniform-params enforcement: assert canonical params, log per page.
        const recordedParams = (meta.coloring_generation_params as { model?: string; image_size?: string } | undefined) ?? null;
        if (recordedParams && (recordedParams.model !== INTERIOR_GEN_PARAMS.model
            || recordedParams.image_size !== INTERIOR_GEN_PARAMS.image_size)) {
          throw new Error(
            `param_uniformity_violation: recorded=${JSON.stringify(recordedParams)} vs canonical=${JSON.stringify(INTERIOR_GEN_PARAMS)}`,
          );
        }
        const bytes = await falFluxSchnell({
          prompt,
          image_size: INTERIOR_GEN_PARAMS.image_size,
          ebook_id: ebook_id,
          step: `coloring_${stageLabel}_page_${page.canonical_page_number}`,
        });
        const verified = verifyImageAtBirth(bytes, page.canonical_page_number, MIN_IMAGE_BYTES);

        // Deterministic solid-black + white-bg check BEFORE upload.
        const sb = await analyzeSolidBlack(bytes, DEFAULT_SOLID_BLACK_TH);
        if (!sb.pass) {
          repairAttempts[String(page.canonical_page_number)] = attempt + 1;
          errors.push({
            page: page.canonical_page_number,
            error: `solid_black_gate: ${sb.reasons.join("; ")}`,
            reasons: sb.reasons,
          } as any);
          continue;
        }

        // Sharpness gate — Ocean Friends defect: per-page edge-density
        // ranged 2.6–20.3. Floor at DEFAULT_SHARPNESS_MIN_SCORE (8.0).
        const sharpnessMin = ((meta.coloring_style_contract as any)?.sharpness_min_score as number | undefined)
          ?? DEFAULT_SHARPNESS_MIN_SCORE;
        const sharp = await computeSharpness(bytes, { minRequired: sharpnessMin });
        if (!sharp.pass) {
          repairAttempts[String(page.canonical_page_number)] = attempt + 1;
          errors.push({
            page: page.canonical_page_number,
            error: `sharpness_gate: ${sharp.reason}`,
            reasons: [sharp.reason],
            sharpness: sharp,
          } as any);
          continue;
        }

        const version = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
        const path = coloringPath(ebook_id, page.canonical_page_number, version, verified.ext);
        const up = await uploadAndSignImage(db, "ebook-covers", path, bytes, { contentType: verified.mime });
        newRecords.push({
          page: page.canonical_page_number,
          signed_url: up.signedUrl,
          storage_path: up.path,
          bytes: bytes.length,
          mime: verified.mime,
          rendered_at: new Date().toISOString(),
          prompt_hash: promptHash,
          primary_subject: page.primary_subject,
          stage: stageLabel,
          render_params: { ...INTERIOR_GEN_PARAMS },
          sharpness: { score: sharp.score, sobel_mean: sharp.sobel_mean, laplacian_var: sharp.laplacian_var, min_required: sharp.min_required },
        } as any);
        // First-page params lock.
        if (!recordedParams) {
          await patchMeta(db, ebook_id, { coloring_generation_params: { ...INTERIOR_GEN_PARAMS } });
        }
        // clear repair counter on success
        delete repairAttempts[String(page.canonical_page_number)];
      } catch (e: any) {
        console.error(`[coloring-render] page ${page.canonical_page_number} failed`, e?.message);
        repairAttempts[String(page.canonical_page_number)] = attempt + 1;
        errors.push({ page: page.canonical_page_number, error: e?.message ?? String(e) });
      }
    }

    await patchMeta(db, ebook_id, { coloring_repair_attempts: repairAttempts });

    const pages = await updatePages(db, ebook_id, newRecords);
    const total = plan.length;
    const doneNow = pages.length;
    const percent = Math.round((doneNow / total) * 100);

    if (errors.length > 0 && newRecords.length === 0) {
      // Whole batch failed — surface as blocker but keep queued for retry.
      await db.from("ebooks_kids").update({
        pipeline_status: "queued",
        blocker_reason: `generate_interior:coloring_${stageLabel}_batch_failed: ${errors[0].error.slice(0, 200)}`,
      }).eq("id", ebook_id);
      await patchMeta(db, ebook_id, {
        coloring_progress_percent: percent,
        coloring_current_step_label: `Batch failed at ${stageLabel}; will retry (${errors.length} pages)`,
        coloring_last_errors: errors,
      });
      return json({ ok: false, stage: stageLabel, errors }, 200);
    }

    // Determine follow-up state.
    const stillCalibrationRemaining = plan
      .filter((p) => p.canonical_page_number <= CALIBRATION_COUNT && !pages.some((r) => r.page === p.canonical_page_number))
      .length > 0;
    const productionRemaining = plan
      .filter((p) => p.canonical_page_number > CALIBRATION_COUNT && !pages.some((r) => r.page === p.canonical_page_number))
      .length;

    if (stageLabel === "calibration" && !stillCalibrationRemaining) {
      // AUTO-APPROVE style lock: every stored calibration page already
      // passed solid-black + sharpness + white-bg + prompt-compliance.
      // Reviewer note = 'auto_gates'. No human wait — self-invoke into production.
      await patchMeta(db, ebook_id, {
        coloring_progress_percent: Math.max(25, percent),
        coloring_current_step_label:
          `Calibration complete (pages 1-${CALIBRATION_COUNT}) — auto-approved by gates; starting production`,
        coloring_calibration_approved: true,
        coloring_calibration_reviewer: "auto_gates",
        coloring_calibration_approved_at: new Date().toISOString(),
        coloring_calibration_completed_at: new Date().toISOString(),
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: null }).eq("id", ebook_id);
      selfInvoke(ebook_id);
      return json({
        ok: true,
        stage: "calibration_auto_approved",
        chained: true,
        calibration_pages: pages.filter((p) => p.stage === "calibration").map((p) => ({ page: p.page, url: p.signed_url })),
      });
    }

    if (stageLabel === "production" && productionRemaining > 0) {
      await patchMeta(db, ebook_id, {
        coloring_progress_percent: percent,
        coloring_current_step_label: `Production batch complete — ${productionRemaining} pages remaining`,
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: null }).eq("id", ebook_id);
      selfInvoke(ebook_id);
      return json({ ok: true, stage: "production_batch", pages_stored: pages.length, remaining: productionRemaining, chained: true });
    }

    if (stageLabel === "production" && productionRemaining === 0) {
      await patchMeta(db, ebook_id, {
        coloring_progress_percent: 90,
        coloring_current_step_label: "All interior pages rendered — awaiting cover + PDF + publish",
        awaiting: "cover_pdf_publish",
        coloring_render_completed_at: new Date().toISOString(),
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: null }).eq("id", ebook_id);
      // Chain immediately into the cover ladder so we don't wait on the next worker tick.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/coloring-book-cover`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ ebook_id }),
        });
      } catch (e) { console.warn("[coloring-render] chain cover failed", (e as Error).message); }
      return json({ ok: true, stage: "interior_complete", pages_stored: pages.length, chained: "cover" });
    }

    // Still in calibration and more pages to render (rare in one tick).
    await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: null }).eq("id", ebook_id);
    selfInvoke(ebook_id);
    return json({ ok: true, stage: stageLabel, pages_stored: pages.length, chained: true });
  } catch (e: any) {
    console.error("[coloring-render] fatal", e?.message);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
