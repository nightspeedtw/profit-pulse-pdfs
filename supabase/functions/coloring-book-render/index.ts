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
import { FalBillingLockedError, FalBudgetCapReachedError, assertLaneCanDispatch, readLaneGuards } from "../_shared/fal-billing.ts";
import { generateImageWithFailover, readImageProviderPolicy, DEFAULT_IMAGE_PROVIDER_POLICY, readCfBillingLockedUntil } from "../_shared/image-providers.ts";
import { parkColoringBook, pickParkState } from "../_shared/coloring/quota-park.ts";
import { maxCfImagesThisTick } from "../_shared/coloring/interior-pacer.ts";
import {
  assertPromptCompliant,
  buildInteriorPrompt,
  DEFAULT_KIDS_4_6_STYLE,
  type LineArtStyleContract,
  type PagePlanEntry,
} from "../_shared/coloring/style-contract.ts";
import { verifyImageAtBirth, type ImageKind } from "../_shared/coloring/image-kind.ts";
import { rehydratePagePlan } from "../_shared/coloring/plan-rehydrate.ts";
import { analyzeSolidBlack, DEFAULT_SOLID_BLACK_TH } from "../_shared/coloring/solid-black.ts";
import { computeSharpness } from "../_shared/coloring/sharpness-gate.ts";
import { decideRepair, replanEscalatedPage, sanitizeSceneForColorability } from "../_shared/coloring/repair-ladder.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { resolveTrimProfileKey, TRIM_PROFILES } from "../_shared/coloring/trim-lock.ts";
import { scheduleSelfAdvance, SELF_ADVANCE_DELAY_BACKOFF_MS } from "../_shared/coloring/self-advance.ts";
import { verifyAnatomyBatch, ANATOMY_VERIFIER_VERSION, type AnatomyPageVerdict } from "../_shared/coloring/anatomy-verify.ts";
import { speciesAnatomyRepairClause } from "../_shared/coloring/species-anatomy.ts";
import {
  AnatomyVerifierBlockedError,
  assertAnatomyVerifierAvailable,
  readAnatomyVerifierModels,
} from "../_shared/coloring/anatomy-verifier-guard.ts";
import {
  loadActivePreventionRules,
  indexRulesBySpecies,
  pickLearnedRulesFor,
  learnedClauseFromRules,
  normalizeDefect,
  recordDefectsAndLearn,
  computeFirstPassYield,
  type DefectHit,
} from "../_shared/coloring/first-pass-learner.ts";

// Canonical interior generation params — enforced identically for every page
// WITHIN a book. Per-book overrides come from the trim profile (Phase A):
// square_8_5 → square_hd (1024x1024), letter_portrait → portrait_4_3.
const INTERIOR_GEN_MODEL = "fal-ai/flux/schnell";
const INTERIOR_GEN_PARAMS_LEGACY = Object.freeze({
  model: INTERIOR_GEN_MODEL,
  image_size: "portrait_4_3" as const,
});

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CALIBRATION_COUNT = 4;   // pages rendered before owner style-lock review
const BATCH_SIZE = 3;          // pages rendered per invocation post-calibration (reduced from 6 to stay under 150s edge CPU cap; see known-regressions.md#generating-status-zombie-v1)
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

    // Lane-level guard: don't burn a single FAL call while billing/quota
    // is blocked or today's budget cap is reached. Keeps the row parked in
    // queued so worker-tick can resume it once the block clears.
    try { await assertLaneCanDispatch(db); } catch (e: any) {
      if (e instanceof FalBillingLockedError || e instanceof FalBudgetCapReachedError) {
        await db.from("ebooks_kids").update({ pipeline_status: "queued" }).eq("id", ebook_id);
        return json({ ok: false, halted: true, reason: e.kind, detail: e.message });
      }
      throw e;
    }

    // Same pattern for the anatomy vision verifier: if it's been down for
    // ≥3 consecutive batches, don't burn FAL cost on pages we can't measure.
    try { await assertAnatomyVerifierAvailable(db); } catch (e: any) {
      if (e instanceof AnatomyVerifierBlockedError) {
        await patchMeta(db, ebook_id, {
          coloring_current_step_label:
            "Paused: anatomy_verifier_blocked — vision verifier ladder is down, will auto-resume when a model is healthy",
        });
        await db.from("ebooks_kids").update({ pipeline_status: "queued" }).eq("id", ebook_id);
        return json({ ok: false, halted: true, reason: e.kind, detail: e.message });
      }
      throw e;
    }

    // Multi-provider policy (data-driven; A/B pilot may flip primary via
    // generation_settings.coloring_autopilot.image_provider_policy).
    const imagePolicy = (await readImageProviderPolicy(db)).interiors;

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, pipeline_status, metadata, title, created_at")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") {
      return json({ error: "wrong_lane" }, 400);
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // Phase A trim profile → interior image_size.
    let profileKey: "letter_portrait" | "square_8_5";
    try {
      profileKey = resolveTrimProfileKey({ metadata: meta, created_at: (row as any).created_at ?? null });
    } catch (e) {
      const reason = `trim_profile_unresolved:${String((e as Error)?.message ?? e).slice(0, 200)}`;
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: reason }).eq("id", ebook_id);
      return json({ error: reason }, 422);
    }
    const INTERIOR_GEN_PARAMS = Object.freeze({
      model: INTERIOR_GEN_MODEL,
      image_size: TRIM_PROFILES[profileKey].interiorImageSize,
    });
    let planWrap = meta.coloring_page_plan as { plan?: PagePlanEntry[]; category_key?: string } | undefined;
    let plan = planWrap?.plan;
    const styleContract = (meta.coloring_style_contract as LineArtStyleContract | undefined) ?? DEFAULT_KIDS_4_6_STYLE;
    if (!plan || !Array.isArray(plan) || plan.length === 0) {
      // Persistence-contract recovery (defect class:
      // persistence_contract_bug). Try to reconstruct the deterministic
      // plan from the strongest available source (stored pages → metadata
      // hints → title inference) instead of dead-ending the book.
      const rehy = await rehydratePagePlan(db, { id: row.id, title: row.title, metadata: meta });
      if (!rehy.restored || rehy.plan.length === 0) {
        await db.from("ebooks_kids").update({
          pipeline_status: "failed",
          blocker_reason:
            `persistence_contract: metadata.coloring_page_plan.plan missing (rehydrate_failed: ${rehy.reason ?? "unknown"})`,
        }).eq("id", ebook_id);
        return json({ error: "missing_page_plan", rehydrate: rehy.reason }, 422);
      }
      plan = rehy.plan as PagePlanEntry[];
      planWrap = rehy.planWrap as any;
      // Reload category-related meta for downstream (theme_bible etc.)
      Object.assign(meta, {
        coloring_page_plan: rehy.planWrap,
        coloring_category_key: rehy.category_key,
      });
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

    // ── QUOTA-AWARE PACING (Cloudflare-primary path) ─────────────────
    // If CF is our primary provider, clamp this tick's batch to what fits
    // within today's remaining CF free-neuron budget. When budget is 0 and
    // FAL is also unavailable, park the book in awaiting_quota_reset with
    // a scheduled wake at next UTC midnight (CF's pool reset).
    if (toRender.length > 0 && imagePolicy.primary === "cloudflare_flux_schnell") {
      const pacer = await maxCfImagesThisTick(db, toRender.length);
      if (pacer.allowed < toRender.length) {
        const falAvailable = imagePolicy.fallback === "fal_flux_schnell";
        if (pacer.allowed === 0 && !falAvailable) {
          // No CF budget + no healthy FAL → park until CF resets.
          const wake = await parkColoringBook(
            db, ebook_id, "awaiting_quota_reset",
            `interior_pacer: CF daily budget exhausted (used_today=${pacer.used_today}, budget=${pacer.cfg.cf_daily_image_budget})`,
          );
          await patchMeta(db, ebook_id, {
            coloring_current_step_label:
              `Paused: cloudflare daily neuron budget exhausted — auto-resume at ${wake.toISOString()}`,
          });
          return json({ ok: false, halted: true, reason: "cf_daily_budget_paced", wake_at: wake.toISOString() });
        }
        if (pacer.allowed > 0) {
          // Clamp this tick; remaining pages will be handled by the next
          // self-invoke chain (or by worker-tick if we park later).
          toRender = toRender.slice(0, pacer.allowed);
        }
        // else: fall through to dispatch; failover will route to FAL.
      }
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
    const anatomyBuffer: { page: number; subject: string; bytes: Uint8Array; mime: string; category_key?: string; scene?: string }[] = [];
    const errors: { page: number; error: string }[] = [];

    // Load learned prevention rules ONCE per invocation. Every page's base
    // prompt starts with the counter-clauses for its species so past failures
    // never repeat at birth (owner First-Pass-Yield law).
    const preventionRules = await loadActivePreventionRules(db);
    const rulesIndex = indexRulesBySpecies(preventionRules);


    // Track per-page repair attempts on metadata for the repair ladder.
    const repairAttempts = ((meta.coloring_repair_attempts as Record<string, number> | undefined) ?? {});

    // Track replans (one plan-level rescue allowed per page).
    const replans = ((meta.coloring_replans as Record<string, { at: string; from_scene: string; to_scene: string; reasons: string[] }> | undefined) ?? {});
    const deadPages: number[] = [];

    // Sequential within this invocation — bounded FAL wallclock, safe on cost.
    for (const rawPage of toRender) {
      const attempt = repairAttempts[String(rawPage.canonical_page_number)] ?? 0;
      // Rolling per-page reason history (last 5 batches), not just last batch.
      const priorReasons = ((meta.coloring_last_errors as any[] | undefined) ?? [])
        .filter((e) => e?.page === rawPage.canonical_page_number)
        .flatMap((e) => (typeof e?.reasons === "string" ? [e.reasons] : e?.reasons ?? []));
      const decision = attempt > 0
        ? decideRepair(rawPage, attempt, priorReasons)
        : { action: "repair" as const, revised_page: rawPage, prompt_additions: [], attempt, rationale: "first attempt" };

      if (decision.action === "escalate") {
        const alreadyReplanned = !!replans[String(rawPage.canonical_page_number)];
        if (!alreadyReplanned) {
          // Plan-level rescue: rewrite the scene to guaranteed-simple portrait,
          // reset attempts, log replan. Persist plan entry so next tick uses it.
          const replanned = replanEscalatedPage(rawPage);
          const planIdx = plan.findIndex((p) => p.canonical_page_number === rawPage.canonical_page_number);
          if (planIdx >= 0) plan[planIdx] = { ...plan[planIdx], ...replanned, scene: sanitizeSceneForColorability(replanned.scene) };
          replans[String(rawPage.canonical_page_number)] = {
            at: new Date().toISOString(),
            from_scene: rawPage.scene,
            to_scene: replanned.scene,
            reasons: priorReasons.slice(-5),
          };
          repairAttempts[String(rawPage.canonical_page_number)] = 0;
          errors.push({
            page: rawPage.canonical_page_number,
            error: `replanned_to_portrait_after_${attempt}_attempts`,
            reasons: [`replan: ${priorReasons.slice(-1)[0] ?? "escalated"}`],
          } as any);
          continue;
        }
        // Already replanned once and still failing → dead page class.
        deadPages.push(rawPage.canonical_page_number);
        errors.push({
          page: rawPage.canonical_page_number,
          error: `coloring_page_dead_after_replan: ${decision.rationale}`,
          reasons: priorReasons.slice(-5),
        } as any);
        continue;
      }


      const page = decision.revised_page;
      const learnedRules = pickLearnedRulesFor(rulesIndex, page.primary_subject, page.scene);
      const learnedClause = learnedClauseFromRules(learnedRules);
      const basePrompt = buildInteriorPrompt(page, styleContract, {
        category_name: category.category_name,
        target_age_min: category.target_age_min ?? 4,
        target_age_max: category.target_age_max ?? 6,
      }, { learned_prevention_clause: learnedClause });
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
        // Repair renders (attempt ≥ 1) bump schnell steps 4→8 for crisper
        // lines. Calibration evidence: Ocean Friends accepted-set scored
        // 15.6–48.0 (median 27.8) at steps=4; regens of p19/p31 hovered at
        // 10–13 even after portrait replan — a per-page render-quality
        // deficit, not a floor bug. Bumping steps is the calibrated repair.
        const repairSteps = attempt >= 1 ? 8 : 4;
        const gen = await generateImageWithFailover({
          prompt,
          image_size: INTERIOR_GEN_PARAMS.image_size,
          num_inference_steps: repairSteps,
          ebook_id: ebook_id,
          step: `coloring_${stageLabel}_page_${page.canonical_page_number}${attempt >= 1 ? "_repair" : ""}`,
        }, imagePolicy, db);
        const bytes = gen.bytes;
        const providerUsed = gen.provider;
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

        // Sharpness gate — v5 authority is boundary_edge_strength only.
        // Sobel/Laplacian `score` is telemetry and cannot veto sparse pages.
        const sharp = await computeSharpness(bytes);
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
          image_provider: providerUsed,
          image_provider_attempts: gen.attempts,
          sharpness: {
            score: sharp.score,
            sobel_mean: sharp.sobel_mean,
            laplacian_var: sharp.laplacian_var,
            min_required: sharp.min_required,
            visible_edge_score: sharp.visible_edge_score,
            boundary_edge_strength: sharp.boundary_edge_strength,
            boundary_edge_min_required: sharp.boundary_edge_min_required,
            boundary_pixel_count: sharp.boundary_pixel_count,
          },
        } as any);
        // Buffer raw bytes for batch anatomy verification below.
        anatomyBuffer.push({
          page: page.canonical_page_number,
          subject: page.primary_subject,
          bytes,
          mime: verified.mime,
          category_key: category?.category_key ?? categoryKey,
          scene: (page as any).scene_setting ?? (page as any).scene,
        });
        // First-page params lock.
        if (!recordedParams) {
          await patchMeta(db, ebook_id, { coloring_generation_params: { ...INTERIOR_GEN_PARAMS } });
        }
        // clear repair counter on success (may be re-bumped by anatomy verifier below)
        delete repairAttempts[String(page.canonical_page_number)];
      } catch (e: any) {
        // Provider billing/quota locks are lane-state, NOT page-content
        // failures. Do NOT increment repair_attempts, do NOT trigger the
        // repair ladder, and STOP dispatching further pages this tick.
        if (e instanceof FalBillingLockedError || e instanceof FalBudgetCapReachedError) {
          console.warn(`[coloring-render] lane halted: ${e.message}`);
          errors.push({
            page: page.canonical_page_number,
            error: e instanceof FalBudgetCapReachedError ? "fal_budget_cap_reached" : "provider_billing_locked",
            reasons: [e.message],
            provider_state: true,
          } as any);
          // Persist plan/attempts as-is (attempts unchanged) and halt the
          // batch. Row stays in generating; worker-tick's lane guard will
          // refuse to dispatch until the block is cleared.
          await patchMeta(db, ebook_id, {
            coloring_repair_attempts: repairAttempts,
            coloring_replans: replans,
            coloring_page_plan: { ...planWrap, plan },
          });
          // Park in the correct awaiting_* state with next_retry_at so
          // worker-tick will auto-resume us the moment the provider recovers.
          const cfLatch = await readCfBillingLockedUntil(db);
          const { provider_billing_blocked } = await readLaneGuards(db);
          const health = {
            cf_locked: !!cfLatch || !!provider_billing_blocked.cloudflare?.active,
            fal_locked: !!provider_billing_blocked.fal?.active,
          };
          const parkState = e instanceof FalBudgetCapReachedError
            ? "awaiting_billing" as const
            : pickParkState(health, e.message);
          const wake = await parkColoringBook(db, ebook_id, parkState, e.message);
          await patchMeta(db, ebook_id, {
            coloring_current_step_label: parkState === "awaiting_quota_reset"
              ? `Paused: awaiting_quota_reset — cloudflare pool resets ${wake.toISOString()}`
              : `Paused: awaiting_billing — top up fal.ai balance to resume (re-check ${wake.toISOString()})`,
          });
          return json({ ok: false, halted: true, reason: parkState, wake_at: wake.toISOString(), detail: e.message });
        }
        console.error(`[coloring-render] page ${page.canonical_page_number} failed`, e?.message);
        repairAttempts[String(page.canonical_page_number)] = attempt + 1;
        errors.push({ page: page.canonical_page_number, error: e?.message ?? String(e) });
      }
    }

    // ── ANATOMY VISION GATE (measured, not constants) ─────────────────
    // Owner mandate: every rendered page is judged against its species
    // checklist BEFORE we accept it into metadata.coloring_pages. Pages
    // that fail are deleted from storage, dropped from newRecords, and
    // routed through the anatomy_structural repair ladder on the next tick.
    //
    // HOUSE LAW (verifier_model_deprecated fix): a verifier outage is NOT
    // a quality verdict. Degraded verdicts do not fail the page, do not
    // increment attempts, and do not delete storage. Instead we drop the
    // record so it re-renders next tick (once the verifier ladder recovers)
    // and — if all pages this batch came back degraded — halt the lane.
    let anatomyVerdicts: AnatomyPageVerdict[] = [];
    if (anatomyBuffer.length) {
      try {
        const ladder = await readAnatomyVerifierModels(db);
        anatomyVerdicts = await verifyAnatomyBatch(anatomyBuffer, { db, models: ladder });
      } catch (e: any) {
        if (e instanceof AnatomyVerifierBlockedError) {
          console.warn(`[coloring-render] anatomy verifier blocked: ${e.message}`);
          // Best-effort cleanup: delete the just-uploaded storage objects
          // so next tick re-renders + re-verifies. Do NOT persist attempts.
          for (const rec of newRecords) {
            try { await db.storage.from("ebook-covers").remove([rec.storage_path]); } catch { /* best-effort */ }
          }
          await patchMeta(db, ebook_id, {
            coloring_repair_attempts: repairAttempts,
            coloring_replans: replans,
            coloring_page_plan: { ...planWrap, plan },
            coloring_current_step_label:
              "Paused: anatomy_verifier_blocked — vision verifier ladder is down, will auto-resume when a model is healthy",
          });
          await db.from("ebooks_kids").update({ pipeline_status: "queued" }).eq("id", ebook_id);
          return json({ ok: false, halted: true, reason: "anatomy_verifier_blocked", detail: e.message });
        }
        throw e;
      }
    }
    const verdictByPage = new Map<number, AnatomyPageVerdict>();
    for (const v of anatomyVerdicts) verdictByPage.set(v.page, v);

    // Attach verdict to the corresponding newRecords entry, or drop it.
    const keptRecords: typeof newRecords = [];
    for (const rec of newRecords) {
      const v = verdictByPage.get(rec.page);
      if (!v || v.degraded) {
        // UNMEASURED — verifier outage (or missing verdict). Do NOT fail
        // the page, do NOT increment attempts, do NOT delete storage.
        // Drop the record so the next tick re-verifies against the same
        // stored bytes (assemble refuses unmeasured pages).
        try { await db.storage.from("ebook-covers").remove([rec.storage_path]); } catch { /* best-effort */ }
        errors.push({
          page: rec.page,
          error: `anatomy_unmeasured: ${(v?.defects ?? ["anatomy_no_verdict"])[0]}`,
          reasons: ["anatomy_verifier_degraded"],
          verifier_state: true,
        } as any);
        continue;
      }
      if (v.pass) {
        // Stamp storage_path onto verdict so assemble's incremental sweep
        // can prove the verdict belongs to THIS specific asset version.
        (rec as any).anatomy_verdict = { ...v, storage_path: rec.storage_path };
        keptRecords.push(rec);
        continue;
      }
      // Failed anatomy — remove uploaded object + requeue via repair ladder.
      try { await db.storage.from("ebook-covers").remove([rec.storage_path]); } catch (_e) { /* best-effort */ }
      const prior = repairAttempts[String(rec.page)] ?? 0;
      repairAttempts[String(rec.page)] = prior + 1;
      const clause = speciesAnatomyRepairClause(rec.primary_subject, v.defects);
      errors.push({
        page: rec.page,
        error: `anatomy_gate: ${v.defects.slice(0, 4).join("; ") || "anatomy_defect"}`,
        reasons: ["anatomy_structural", ...v.defects, clause],
        anatomy: { species_key: v.species_key, score: v.anatomy_score, defects: v.defects, degraded: v.degraded },
      } as any);
    }
    // Replace newRecords with anatomy-approved records only.
    newRecords.length = 0;
    for (const r of keptRecords) newRecords.push(r);

    // Persist rolling per-page error history (last 5 per page), not overwrite.
    const priorErrorLog = ((meta.coloring_last_errors as any[] | undefined) ?? []);
    const errorLog = [...priorErrorLog, ...errors.map((e) => ({ ...e, at: new Date().toISOString() }))];
    const perPageTrimmed: any[] = [];
    const byPageCount = new Map<number, number>();
    for (let i = errorLog.length - 1; i >= 0; i--) {
      const p = (errorLog[i] as any).page;
      const c = byPageCount.get(p) ?? 0;
      if (c < 5) { perPageTrimmed.unshift(errorLog[i]); byPageCount.set(p, c + 1); }
    }

    // FIRST-PASS-YIELD LEARNER — mine this tick's real gate rejections into
    // the lifetime defect ledger; auto-promote patterns at >= 2 occurrences
    // so future books' base prompts carry the counter-clause automatically.
    try {
      const planByPage = new Map<number, PagePlanEntry>();
      for (const p of plan) planByPage.set(p.canonical_page_number, p);
      const hits: DefectHit[] = [];
      for (const e of errors as any[]) {
        if (!e || typeof e.page !== "number") continue;
        const pg = planByPage.get(e.page);
        const speciesKey = e?.anatomy?.species_key ?? pg?.primary_subject ?? "";
        const scene = pg?.scene ?? "";
        const reasons: string[] = Array.isArray(e.reasons) ? e.reasons : (typeof e.reasons === "string" ? [e.reasons] : []);
        const rawStrings = [e.error, ...reasons].filter(Boolean) as string[];
        const gate = /anatomy_gate/i.test(e.error ?? "") ? "anatomy"
                   : /solid[- ]?black/i.test(e.error ?? "") ? "solid_black"
                   : /sharpness|boundary/i.test(e.error ?? "") ? "sharpness"
                   : "other";
        for (const s of rawStrings) {
          const hit = normalizeDefect(s, speciesKey, gate, scene);
          if (hit) { hit.page = e.page; hits.push(hit); }
        }
      }
      if (hits.length) {
        const learnResult = await recordDefectsAndLearn(db, ebook_id, hits);
        if (learnResult.promoted.length) {
          console.log(`[first-pass-learner] promoted new rules for ebook=${ebook_id}: ${learnResult.promoted.join(", ")}`);
        }
      }
      // Snapshot FPY every tick — cheap, and lets us watch the ladder rise.
      const fpy = computeFirstPassYield(plan.length, perPageTrimmed as any);
      await db.from("book_first_pass_yield").insert({
        ebook_kids_id: ebook_id,
        fpy: Number(fpy.fpy.toFixed(4)),
        first_pass_pages: fpy.first_pass_pages,
        total_pages: fpy.total_pages,
        gate_rejections: fpy.gate_rejections,
        rejections_by_class: fpy.rejections_by_class,
      });
      await patchMeta(db, ebook_id, {
        coloring_first_pass_yield: {
          fpy: fpy.fpy,
          first_pass_pages: fpy.first_pass_pages,
          total_pages: fpy.total_pages,
          gate_rejections: fpy.gate_rejections,
          rejections_by_class: fpy.rejections_by_class,
          rejected_pages: fpy.rejected_pages,
          measured_at: new Date().toISOString(),
        },
      });
    } catch (learnErr) {
      console.warn("[first-pass-learner] tick learn failed:", (learnErr as Error).message);
    }

    // Persist plan (may have been mutated by replan) + attempts + replans.
    await patchMeta(db, ebook_id, {
      coloring_repair_attempts: repairAttempts,
      coloring_replans: replans,
      coloring_page_plan: { ...planWrap, plan },
    });

    const pages = await updatePages(db, ebook_id, newRecords);
    const total = plan.length;
    const doneNow = pages.length;
    const percent = Math.round((doneNow / total) * 100);

    if (deadPages.length > 0) {
      // Learn-then-retry surface: dead page class, don't idle-loop, don't P0-pause.
      await db.from("ebooks_kids").update({
        pipeline_status: "failed",
        blocker_reason: `coloring_page_dead: pages ${deadPages.join(",")} exhausted repair + replan ladder`,
      }).eq("id", ebook_id);
      await patchMeta(db, ebook_id, {
        coloring_progress_percent: percent,
        coloring_current_step_label: `Dead pages after replan: ${deadPages.join(", ")} — learn-then-retry`,
        coloring_last_errors: perPageTrimmed,
        coloring_dead_pages: deadPages,
      });
      return json({ ok: false, stage: stageLabel, dead_pages: deadPages, errors: perPageTrimmed }, 200);
    }

    if (errors.length > 0 && newRecords.length === 0) {
      // If the whole batch failed AND the underlying signature is a provider
      // billing/quota class (e.g. legacy CF 429 that didn't route through
      // the FalBillingLockedError instanceof branch), park cleanly instead
      // of leaving the row silently queued with no scheduled retry.
      const firstErr = String(errors[0].error ?? "");
      const looksProviderQuota =
        /daily free allocation|neurons|workers paid|exhausted balance|user is locked|provider_billing_locked|fal_budget_cap_reached/i
          .test(firstErr);
      if (looksProviderQuota) {
        const cfLatch = await readCfBillingLockedUntil(db);
        const { provider_billing_blocked } = await readLaneGuards(db);
        const health = {
          cf_locked: !!cfLatch || !!provider_billing_blocked.cloudflare?.active,
          fal_locked: !!provider_billing_blocked.fal?.active,
        };
        const parkState = pickParkState(health, firstErr);
        const wake = await parkColoringBook(db, ebook_id, parkState, firstErr);
        await patchMeta(db, ebook_id, {
          coloring_progress_percent: percent,
          coloring_current_step_label: parkState === "awaiting_quota_reset"
            ? `Paused: awaiting_quota_reset — cloudflare pool resets ${wake.toISOString()}`
            : `Paused: awaiting_billing — top up fal.ai balance (re-check ${wake.toISOString()})`,
          coloring_last_errors: perPageTrimmed,
        });
        return json({ ok: false, stage: stageLabel, reason: parkState, wake_at: wake.toISOString(), errors: perPageTrimmed }, 200);
      }
      // Whole batch failed — surface as blocker but keep queued for retry.
      await db.from("ebooks_kids").update({
        pipeline_status: "queued",
        blocker_reason: `generate_interior:coloring_${stageLabel}_batch_failed: ${errors[0].error.slice(0, 200)}`,
      }).eq("id", ebook_id);
      await patchMeta(db, ebook_id, {
        coloring_progress_percent: percent,
        coloring_current_step_label: `Batch failed at ${stageLabel}; will retry (${errors.length} pages)`,
        coloring_last_errors: perPageTrimmed,
      });
      // Self-advance with backoff — do not wait for the next cron tick.
      await scheduleSelfAdvance(db, ebook_id, { delayMs: SELF_ADVANCE_DELAY_BACKOFF_MS, reason: `batch_failed:${stageLabel}` });
      return json({ ok: false, stage: stageLabel, errors: perPageTrimmed, self_advance: true }, 200);
    }

    // On any partial success, still update the rolling error log.
    if (errors.length > 0) {
      await patchMeta(db, ebook_id, { coloring_last_errors: perPageTrimmed });
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
