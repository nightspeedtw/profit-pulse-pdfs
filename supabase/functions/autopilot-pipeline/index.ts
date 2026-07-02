// Milestone 8 + 10 — Autopilot Pipeline (12-step) with production hardening.
//
// POST { idea_id?, ebook_id?, mode? }
// Steps:
//   1. generate-idea  → 2. idea-copywriter (QC idea) → 4/5. generate-outline
//   6/7. write-chapters → 8. final-manuscript-qc → 9. generate-cover
//   10/11. render-pdf (auto QC) → 12. shopify-draft-upload [→ 13. shopify-publish]
//
// Milestone 10 hardening:
//   - Per-step retries (AI: 2, PDF: 2, Shopify: 3, image: 1) via withRetry.
//   - Per-step logging to pipeline_step_logs (start, end, duration, cost, error).
//   - Daily-cost guard auto-pauses autopilot + flags cost_limit_reached.
//   - Per-ebook AI-call & rewrite caps (max_ai_calls_per_ebook, max_rewrite_attempts).
//   - Daily Shopify upload cap (max_shopify_uploads_per_day).
//   - Failed steps mark production_queue with last_error + attempts++.
//   - Pipeline is idempotent so "Resume from failed step" just re-invokes it.
import { admin, corsHeaders } from "../_shared/ai.ts";
import { logRun } from "../_shared/qc.ts";
import {
  enforceCostGuard,
  markQueueFailed,
  retriesFor,
  stepLog,
  withRetry,
} from "../_shared/retry.ts";
import { RunTracker } from "../_shared/run-tracker.ts";
import {
  LOCK_HEAVY, tryAcquireLock, releaseLock, getLockHolder,
  enqueueShopifyUpload, nextUtcMidnight, browserlessBackoffAt,
} from "../_shared/recovery.ts";

interface InvokeResult { ok: boolean; status: number; body: any; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    let { idea_id, ebook_id, mode, test_mode } = body as { idea_id?: string; ebook_id?: string; mode?: string; test_mode?: boolean };

    // Authenticated user (best-effort) for triggered_by attribution.
    let triggered_by: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const { data } = await db.auth.getUser(authHeader.slice(7));
        triggered_by = data?.user?.id ?? null;
      }
    } catch { /* ignore */ }

    // ---- Load settings ----
    const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).maybeSingle();
    if (!settings) return json({ error: "generation_settings missing" }, 500);
    if (settings.paused) return json({ skipped: "autopilot paused", cost_limit_reached: !!settings.cost_limit_reached });

    mode = mode ?? settings.autopilot_mode ?? "safe";
    const autoPublish: boolean = !!settings.auto_publish && mode === "full";
    const shopifyDraftEnabled: boolean = settings.shopify_draft_upload_enabled !== false;
    const perEbookBudget = Number(settings.per_ebook_budget_usd ?? 2);
    const maxAiCallsPerEbook = Number(settings.max_ai_calls_per_ebook ?? 60);
    const maxShopifyPerDay = Number(settings.max_shopify_uploads_per_day ?? 20);

    // ---- Daily-cost guard (pauses autopilot if tripped) ----
    const guard = await enforceCostGuard(db);
    if (guard.tripped) {
      return json({ skipped: `cost_limit_reached ($${guard.spent.toFixed(2)} ≥ $${guard.budget.toFixed(2)})` });
    }

    // ---- Live run tracker (visible to admin UI via Realtime) ----
    const tracker = await RunTracker.start(db, {
      ebook_id: ebook_id ?? null,
      idea_id: idea_id ?? null,
      mode,
      test_mode: !!test_mode,
      triggered_by,
    });
    const run_id = tracker.runId;

    // ---- Pipeline (background) ----
    const pipeline = (async () => {
      let ebook: any = null;
      let idea: any = null;

      // ---- helper: run a pipeline step with retries + per-step log + queue tracking
      async function runStep(step_name: string, fnName: string, payload: unknown): Promise<InvokeResult> {
        const logger = await stepLog(db, { ebook_id: ebook?.id ?? null, idea_id: idea?.id ?? idea_id ?? null, step_name, payload: { fn: fnName } });
        let attempts = 0;
        try {
          const { value, attempts: a } = await withRetry(
            async (n) => {
              attempts = n;
              const r = await invokeFn(fnName, payload);
              if (!r.ok) throw new Error(`${fnName} HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
              return r;
            },
            { retries: retriesFor(step_name), label: step_name, delayMs: 1000 },
          );
          attempts = a;
          await logger.finish("ok", { retry_count: attempts - 1, payload: { fn: fnName, status: value.status } });
          await logRun(db, { ebook_id: ebook?.id ?? null, idea_id: idea?.id ?? idea_id ?? null, step: step_name, status: "ok", payload: value.body, rewrite_count: attempts - 1 });
          return value;
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          await logger.finish("fail", { retry_count: attempts - 1, error_message: msg, payload: { fn: fnName } });
          await logRun(db, { ebook_id: ebook?.id ?? null, idea_id: idea?.id ?? idea_id ?? null, step: step_name, status: "fail", error: msg });
          await markQueueFailed(db, ebook?.id ?? null, step_name, msg);
          throw err;
        }
      }

      // Track one or more pipeline steps as a single underlying action.
      async function track(stepNames: string[], message: string, fn: () => Promise<void>, subtask?: string) {
        if (await tracker.isPauseRequested()) {
          await tracker.markPaused();
          throw new Error("paused_by_admin");
        }
        for (const n of stepNames) await tracker.startStep(n, message, subtask);
        try {
          await fn();
          for (const n of stepNames) await tracker.passStep(n);
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          await tracker.failStep(stepNames[stepNames.length - 1], msg);
          throw err;
        }
      }

      // Skip multiple steps with a single message. When `existing` is true
      // (the section already has valid saved output) the UI shows
      // "Passed — existing output found" instead of a confusing "Skipped".
      async function skip(stepNames: string[], message: string, existing = true) {
        for (const n of stepNames) await tracker.skipStep(n, message, { existing });
      }

      // Translate "needs_review" exits into a clear admin-needed marker on the run.
      async function needsAdmin(step: string, reason: string, recommended?: string) {
        await tracker.needsAdmin(step, reason, recommended);
      }

      try {
        // ---------- STEP 1+2+3 — Generate idea + title/hook + idea QC ----------
        if (!idea_id && !ebook_id) {
          await track(
            ["generate_idea", "title_and_hook", "idea_qc"],
            "Generating one premium ebook idea, writing title & hook, and running idea QC…",
            async () => {
              const gen = await runStep("1_generate_topic", "generate-idea", { count: 1, category_mix: settings.category_mix ?? null });
              idea_id = gen.body?.ids?.[0] ?? gen.body?.ideas?.[0]?.id ?? gen.body?.id;
              if (!idea_id) throw new Error("generate-idea returned no idea");
            },
          );
        } else {
          await skip(["generate_idea"], "Idea already provided");
        }

        if (idea_id) {
          const { data: i } = await db.from("ebook_ideas").select("*").eq("id", idea_id).maybeSingle();
          idea = i;
          if (idea?.status === "rejected") {
            await logRun(db, { idea_id, step: "qc_idea", status: "reject", error: idea.auto_rejected_reason });
            await needsAdmin("idea_qc", `Idea rejected: ${idea.auto_rejected_reason ?? "unknown reason"}`, "Generate a new idea or unblock this one manually.");
            return;
          }
          if (idea && idea.premium_score == null && (!idea.title || idea.title.trim().length < 5)) {
            await track(
              ["title_and_hook", "idea_qc"],
              "Writing title, subtitle, and hard-sell hook…",
              async () => {
                await runStep("2_best_title_qc", "idea-copywriter", { mode: "generate_one_best_concept", category_id: idea.category_id });
                const { data: i2 } = await db.from("ebook_ideas").select("*").eq("id", idea_id).maybeSingle();
                idea = i2;
              },
            );
          } else if (idea && idea.premium_score == null) {
            await db.from("ebook_ideas").update({
              premium_score: 85, hard_sell_score: 85, buyer_appeal_score: 85,
              idea_score: 85, compliance_risk_score: 2, topic_rewrite_count: 1,
            }).eq("id", idea_id);
            await logRun(db, { idea_id, step: "2_best_title_qc", status: "ok", payload: { skipped: "existing idea, auto-scored" } });
            await skip(["title_and_hook", "idea_qc"], "Existing idea — auto-scored");
            const { data: i2 } = await db.from("ebook_ideas").select("*").eq("id", idea_id).maybeSingle();
            idea = i2;
          } else {
            await skip(["title_and_hook", "idea_qc"], "Idea already scored");
          }
        }

        // Ensure an ebook row exists for steps 4+
        if (!ebook_id && idea_id) {
          const { data: existing } = await db.from("ebooks").select("*").eq("idea_id", idea_id)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (existing) { ebook = existing; ebook_id = existing.id; }
          else {
            const price = 29.0;
            const { data: e, error } = await db.from("ebooks").insert({
              idea_id, category_id: idea?.category_id,
              title: idea?.title ?? "Untitled",
              subtitle: idea?.subtitle, target_buyer: idea?.target_buyer, hook: idea?.hook,
              price, autopilot_mode: mode, autopilot_state: "outline",
              pipeline_status: "ideation",
            }).select("*").single();
            if (error || !e) throw new Error(`create ebook: ${error?.message}`);
            ebook = e; ebook_id = e.id;
          }
        }
        if (!ebook && ebook_id) {
          const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).maybeSingle();
          ebook = e;
        }
        if (!ebook) throw new Error("no ebook to drive pipeline");
        await tracker.setEbook(ebook.id);

        // ============================================================
        // SEQUENTIAL SAFE MODE — heavy_production lock.
        //
        // Only one ebook may occupy heavy production (chapters →
        // manuscript QC → cover → PDF → Shopify) at a time. Other
        // ebooks wait in `queued_for_production` and are auto-resumed
        // by the recovery worker when the lock frees. Idea generation
        // above this line runs freely (allowed parallel step).
        // ============================================================
        const sequentialSafeMode = settings.sequential_safe_mode !== false;
        if (sequentialSafeMode) {
          const heavyLock = await tryAcquireLock(db, LOCK_HEAVY, ebook.id, { ttlSec: 90 * 60, runId: run_id });
          if (!heavyLock.acquired) {
            const holder = await getLockHolder(db, LOCK_HEAVY);
            await db.from("ebooks").update({
              autopilot_state: "queued_for_production",
              blocker_class: "recoverable_dependency_error",
              blocker_reason: "waiting_for_production_slot",
              needs_review_reason: null,
              next_retry_at: browserlessBackoffAt(1),
            }).eq("id", ebook.id);
            await tracker.heartbeat("outline", {
              message: "Queued — waiting for production slot",
              subtask: `Another ebook (${String(holder.holder ?? "").slice(0, 8)}) is currently in heavy production. Auto-resumes when slot frees.`,
            });
            await logRun(db, { ebook_id: ebook.id, step: "queue_wait", status: "skip", error: "heavy_production_lock_busy" });
            await db.from("autopilot_pipeline_runs").update({
              status: "queued",
              current_action_message: "Queued — waiting for production slot",
            }).eq("id", run_id);
            return;
          }
        }

        if (ebook.autopilot_state === "failed" || ebook.autopilot_state === "queued_for_production") {
          await db.from("ebooks").update({ autopilot_state: "production_running", needs_review_reason: null, blocker_class: null, blocker_reason: null }).eq("id", ebook.id);
        } else {
          await db.from("ebooks").update({ autopilot_mode: mode, autopilot_state: "production_running" }).eq("id", ebook.id);
        }

        // ---- ebook-scoped guards ----
        const overBudget = async () => {
          const { data: c } = await db.from("cost_log").select("cost_usd").eq("ebook_id", ebook.id);
          const ec = (c ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd), 0);
          if (ec >= perEbookBudget) {
            await db.from("ebooks").update({
              autopilot_state: "needs_review",
              needs_review_reason: `per-ebook budget exceeded ($${ec.toFixed(2)} ≥ $${perEbookBudget})`,
            }).eq("id", ebook.id);
            return true;
          }
          return false;
        };
        const overAiCalls = async () => {
          const { count } = await db.from("pipeline_step_logs")
            .select("id", { count: "exact", head: true })
            .eq("ebook_id", ebook.id).neq("status", "skip");
          if ((count ?? 0) >= maxAiCallsPerEbook) {
            await db.from("ebooks").update({
              autopilot_state: "needs_review",
              needs_review_reason: `max AI calls per ebook reached (${count} ≥ ${maxAiCallsPerEbook})`,
            }).eq("id", ebook.id);
            return true;
          }
          return false;
        };
        const shopifyOverDay = async () => {
          const ds = new Date(); ds.setUTCHours(0, 0, 0, 0);
          const { count } = await db.from("shopify_sync_logs")
            .select("id", { count: "exact", head: true })
            .gte("created_at", ds.toISOString());
          return (count ?? 0) >= maxShopifyPerDay;
        };

        // ---------- STEP 4 + 5 — Outline + QC (with strict dependency validation) ----------
        const MIN_OUTLINE_CHAPTERS = 8;
        const hasValidOutline = (e: any) => {
          const o = e?.outline_json as any;
          return !!(o && Array.isArray(o.chapters) && o.chapters.length >= MIN_OUTLINE_CHAPTERS);
        };

        // Dependency-repair helper: ensures a valid outline exists, regenerating up
        // to 3 times before escalating. This recovers from the historical bug where
        // outline_json was set without a `chapters` array (or with an empty one),
        // which previously caused write-chapters to fail with "No outline yet".
        async function ensureValidOutline() {
          if (hasValidOutline(ebook)) {
            await skip(["outline", "outline_qc"], "Outline already present");
            return;
          }
          let attempts = 0;
          while (!hasValidOutline(ebook)) {
            if (attempts >= 3) {
              await db.from("ebooks").update({
                autopilot_state: "needs_review",
                needs_review_reason: "Outline could not be generated after 3 dependency-repair attempts.",
              }).eq("id", ebook.id);
              await needsAdmin(
                "outline",
                "Admin needed because generate_outline did not return a valid chapters array after 3 attempts. Missing: outline_json.chapters",
                "Inspect generate-outline logs or regenerate manually.",
              );
              throw new Error("outline_dependency_repair_exhausted");
            }
            attempts++;
            if (await overBudget() || await overAiCalls()) {
              await needsAdmin("outline", "Budget or AI-call cap reached during outline repair.", "Raise per-ebook budget or unblock the job.");
              throw new Error("outline_dependency_budget");
            }
            const label = attempts === 1
              ? "Generating chapter outline and running outline QC…"
              : `Generating outline — repairing invalid outline JSON, attempt ${attempts}/3`;
            try {
              await track(["outline", "outline_qc"], label, async () => {
                await runStep("4_5_outline_qc", "generate-outline", { ebook_id: ebook.id });
                await refreshEbook();
                if (!hasValidOutline(ebook)) {
                  throw new Error(
                    `generate-outline did not return a valid chapters array (got ${
                      Array.isArray((ebook?.outline_json as any)?.chapters)
                        ? (ebook.outline_json as any).chapters.length
                        : "none"
                    }).`,
                  );
                }
              });
            } catch (err) {
              if (attempts >= 3) throw err;
              // loop and retry
            }
          }
        }

        await ensureValidOutline();

        // ---------- STEP 6 + 7 — Write chapters (sequential w/ heartbeat) ----------
        // Hard dependency: outline must be valid before we ever invoke write-chapters.
        if (!hasValidOutline(ebook)) {
          await needsAdmin("chapter_writing", "Outline still missing after repair — refusing to start chapter writing.");
          throw new Error("outline_missing_before_write_chapters");
        }

        // Per-chapter minimum used to decide "missing or too weak".
        const MIN_CHAPTER_WORDS = 600;

        // Return list of outline chapter indices that are missing or below threshold.
        async function findIncompleteChapters(): Promise<number[]> {
          const outlineChapters: any[] = Array.isArray((ebook.outline_json as any)?.chapters)
            ? (ebook.outline_json as any).chapters : [];
          const { data: rows } = await db.from("ebook_chapters")
            .select("chapter_index,word_count,content").eq("ebook_id", ebook.id);
          const have = new Map<number, { wc: number; len: number }>();
          for (const r of rows ?? []) {
            have.set(Number(r.chapter_index), {
              wc: Number(r.word_count ?? 0),
              len: typeof r.content === "string" ? r.content.trim().length : 0,
            });
          }
          const missing: number[] = [];
          for (let i = 0; i < outlineChapters.length; i++) {
            const oc: any = outlineChapters[i];
            const idx = Number(oc?.index ?? oc?.chapter_number ?? oc?.number ?? i + 1);
            const h = have.get(idx);
            if (!h || h.len === 0 || h.wc < MIN_CHAPTER_WORDS) missing.push(idx);
          }
          return missing.sort((a, b) => a - b);
        }

        // Generate the listed chapter indices sequentially via single-chapter mode,
        // updating the live tracker heartbeat after each one. This replaces the old
        // "background all=true" call that returned before chapters were saved and
        // left manuscript QC to regenerate them later.
        async function writeChaptersSequentially(indices: number[], label: (cur: number, total: number, idx: number) => string) {
          let cur = 0;
          for (const idx of indices) {
            cur++;
            if (await tracker.isPauseRequested()) {
              await tracker.markPaused();
              throw new Error("paused_by_admin");
            }
            await tracker.heartbeat("chapter_writing", {
              message: "Writing chapters…",
              subtask: label(cur, indices.length, idx),
              subtask_index: cur,
              subtask_total: indices.length,
              progress_percent: Math.round((cur / Math.max(1, indices.length)) * 100),
            });
            await runStep(`6_write_chapter_${idx}`, "write-chapters", { ebook_id: ebook.id, chapter_index: idx });
          }
          await refreshEbook();
        }

        // Initial write pass: only write chapters that aren't already complete.
        {
          const incompleteBefore = await findIncompleteChapters();
          if (incompleteBefore.length === 0) {
            await skip(["chapter_writing", "chapter_qc"], "Chapters already written");
          } else {
            if (await overBudget() || await overAiCalls()) {
              await needsAdmin("chapter_writing", "Budget cap reached before chapter writing.", "Raise per-ebook budget or unblock the job.");
              return;
            }
            await track(
              ["chapter_writing", "chapter_qc"],
              `Writing chapters…`,
              async () => {
                await writeChaptersSequentially(
                  incompleteBefore,
                  (cur, total, idx) => `Writing chapter ${cur} of ${total} (outline #${idx})`,
                );
                // Repair loop: up to 3 passes targeting only still-missing chapters.
                for (let attempt = 1; attempt <= 3; attempt++) {
                  const stillMissing = await findIncompleteChapters();
                  if (stillMissing.length === 0) return;
                  await tracker.heartbeat("chapter_writing", {
                    message: "Repairing missing dependency…",
                    subtask: `Generating missing chapter 1 of ${stillMissing.length} — pass ${attempt}/3`,
                  });
                  await writeChaptersSequentially(
                    stillMissing,
                    (cur, total, idx) => `Generating missing chapter ${cur} of ${total} (outline #${idx}) — pass ${attempt}/3`,
                  );
                }
                const finalMissing = await findIncompleteChapters();
                if (finalMissing.length > 0) {
                  throw new Error(`chapter_writing incomplete: missing chapters [${finalMissing.join(", ")}] after 3 repair passes`);
                }
              },
              `Writing chapter 1 of ${incompleteBefore.length}`,
            );
          }
        }

        // ---------- STEP 8 — Final manuscript QC ----------
        // Guarantee: never enter manuscript QC with missing chapters. If anything
        // is still missing here (e.g. resume path that skipped writing), route
        // back to chapter_writing and repair via write-chapters — manuscript QC
        // must not regenerate many chapters internally.
        if (ebook.manuscript_qc_status !== "manuscript_passed" && ebook.manuscript_qc_status !== "pass" && ebook.manuscript_qc_status !== "approved") {
          if (await overBudget()) {
            await needsAdmin("manuscript_qc", "Budget cap reached before manuscript QC.");
            return;
          }

          const missingNow = await findIncompleteChapters();
          if (missingNow.length > 0) {
            await track(
              ["chapter_writing", "chapter_qc"],
              `Manuscript QC found ${missingNow.length} missing chapter${missingNow.length === 1 ? "" : "s"}. Returning to Writing Chapters to generate only the missing ones…`,
              async () => {
                await writeChaptersSequentially(
                  missingNow,
                  (cur, total, idx) => `Generating missing chapter ${cur}/${total} (outline #${idx})…`,
                );
                const stillMissing = await findIncompleteChapters();
                if (stillMissing.length > 0) {
                  throw new Error(`Missing chapters still unresolved after repair: [${stillMissing.join(", ")}]`);
                }
              },
            );
          }

          await track(
            ["manuscript_qc"],
            "Running manuscript QC…",
            async () => {
              await runStep("8_final_manuscript_qc", "final-manuscript-qc", { ebook_id: ebook.id, run_id });
              await refreshEbook();
            },
            "Checking structure, depth, and repeated passages across chapters",
          );

          if (ebook.manuscript_qc_status === "needs_review") {
            const qc = (ebook.final_manuscript_qc as any) ?? {};
            const reasons: Array<{ message?: string; code?: string }> = Array.isArray(qc.failed_reasons) ? qc.failed_reasons : [];
            const attemptsUsed: number = Number(qc.attempts_used ?? ebook.manuscript_fix_count ?? 0);
            const top = reasons.slice(0, 4).map((r) => `• ${r.message ?? r.code ?? "unknown issue"}`).join("\n");
            const detail = reasons.length
              ? `Manuscript QC could not be repaired after ${attemptsUsed}/3 targeted attempts.\nUnresolved issues:\n${top}`
              : `Manuscript QC failed after ${attemptsUsed}/3 repair attempts. (No structured reasons were captured — rerun manuscript QC for diagnostics.)`;
            await db.from("ebooks").update({
              autopilot_state: "needs_review",
              needs_review_reason: detail,
            }).eq("id", ebook.id);
            await needsAdmin("manuscript_qc", detail, "Edit weak chapters or rerun manuscript QC.");
            return;
          }
        } else {
          await skip(["manuscript_qc"], "Manuscript QC already passed");
        }


        // ---------- STEP 9 — Cover + thumbnail ----------
        if (!ebook.cover_url) {
          if (await overBudget()) {
            await needsAdmin("cover", "Budget cap reached before cover.");
            return;
          }
          await track(
            ["cover", "cover_qc", "thumbnail", "thumbnail_qc"],
            "Generating premium cover…",
            async () => {
              await tracker.heartbeat("cover", { message: "Generating premium cover…", subtask: "Creating no-text background image" });
              await runStep("9_cover", "generate-cover", { ebook_id: ebook.id, mode: "full" });
              await tracker.heartbeat("thumbnail_qc", { message: "Running thumbnail QC…", subtask: "Checking mobile readability" });
              await refreshEbook();
            },
            "Creating no-text background image",
          );
        } else {
          await skip(["cover", "cover_qc", "thumbnail", "thumbnail_qc"], "Cover already present");
        }

        // ---------- STEP 10 + 11 — PDF ----------
        if (!ebook.pdf_url || ebook.pdf_status === "needs_review" || ebook.pdf_status === "failed") {
          if (await overBudget()) {
            await needsAdmin("pdf_render", "Budget cap reached before PDF render.");
            return;
          }
          await track(
            ["pdf_layout", "pdf_render", "pdf_qc"],
            "Rendering premium PDF…",
            async () => {
              await tracker.heartbeat("pdf_render", { message: "Rendering premium PDF…", subtask: "Building worksheet pages" });
              await runStep("10_11_render_pdf_qc", "render-pdf", { ebook_id: ebook.id });
              await tracker.heartbeat("pdf_qc", { message: "Running PDF QC…", subtask: "Verifying layout and asset integrity" });
              await refreshEbook();
              // Auto-retry: if the premium gate failed (needs_review) but a
              // pdf_url exists, re-render up to 2 more times. The compliance
              // linter, header-shortening, and illustration planner all run
              // fresh each render, so risky/overflow headers get progressively
              // repaired without admin intervention.
              for (let attempt = 1; attempt <= 2 && ebook.pdf_status === "needs_review"; attempt++) {
                await tracker.heartbeat("pdf_qc", {
                  message: `Auto-fixing PDF (attempt ${attempt}/2)…`,
                  subtask: "Repairing worksheet overflow / visuals / compliance",
                });
                await runStep(`10_11_render_pdf_qc_retry_${attempt}`, "render-pdf", { ebook_id: ebook.id, force: true });
                await refreshEbook();
              }
            },
            "Building worksheet pages",
          );
          // Soft-pass: only stop on truly missing PDF. Low QC scores are
          // logged but do not block Shopify draft upload — admin can fix later.
          if (!ebook.pdf_url) {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "PDF render failed — no pdf_url" }).eq("id", ebook.id);
            await needsAdmin("pdf_qc", "PDF render produced no file after auto-fix attempts.", "Regenerate PDF.");
            return;
          }
          if (ebook.pdf_status === "needs_review") {
            console.warn("PDF QC below premium threshold after retries — continuing to product copy + Shopify draft.");
          }

        } else {
          await skip(["pdf_layout", "pdf_render", "pdf_qc"], "PDF already rendered");
        }

        // ---------- STEP 11b — Automatic Psychological Pricing ----------
        if (!ebook.pricing_computed_at) {
          await track(
            ["pricing"],
            "Computing recommended price (psychological pricing engine)…",
            async () => {
              const useLaunch = !!settings.use_launch_price;
              await runStep("11b_pricing", "compute-pricing", { ebook_id: ebook.id, use_launch_price: useLaunch });
              await refreshEbook();
            },
          );
          const conf = Number(ebook.price_confidence_score ?? 0);
          if (conf > 0 && conf < 85) {
            // Don't block — just record an admin-attention note; price still applied.
            await tracker.needsAdmin(
              "pricing",
              `Price confidence ${conf} < 85 — review recommended price ($${ebook.recommended_price ?? ebook.price}).`,
              "Confirm or override the recommended price before publishing.",
            );
          }
        } else {
          await skip(["pricing"], "Pricing already computed");
        }

        // ---------- STEP 12 — Shopify draft ----------
        if (shopifyDraftEnabled && !ebook.shopify_product_id) {
          if (await shopifyOverDay()) {
            const { enqueueShopifyUpload, nextUtcMidnight } = await import("../_shared/recovery.ts");
            const nextRetry = nextUtcMidnight();
            await db.from("ebooks").update({
              autopilot_state: "waiting_for_shopify_quota",
              blocker_class: "recoverable_quota_error",
              blocker_reason: "daily_shopify_upload_cap_reached",
              needs_review_reason: null,
              next_retry_at: nextRetry,
            }).eq("id", ebook.id);
            await enqueueShopifyUpload(db, ebook.id, {
              run_id,
              reason: "daily_shopify_upload_cap_reached",
              nextRetryAt: nextRetry,
            });
            await tracker.heartbeat("shopify_draft", {
              message: `Waiting for Shopify quota — cap ${maxShopifyPerDay}/day reached. Auto-resumes at next window.`,
              subtask: "Queued in Shopify Upload Queue",
            });
            await logRun(db, { ebook_id: ebook.id, step: "12_shopify_draft", status: "skip", error: "shopify daily cap → queued" });
            return;
          }
          await track(
            ["product_copy", "product_qc", "shopify_draft", "shopify_verify"],
            "Uploading Shopify draft…",
            async () => {
              await tracker.heartbeat("product_copy", { message: "Generating Shopify product copy…", subtask: "Writing title, bullets, and description" });
              await tracker.heartbeat("shopify_draft", { message: "Uploading Shopify draft…", subtask: "Creating product and attaching digital PDF" });
              await runStep("12_shopify_draft", "shopify-draft-upload", { ebook_id: ebook.id });
              await tracker.heartbeat("shopify_verify", { message: "Verifying Shopify draft…", subtask: "Checking product assets and pricing" });
              await refreshEbook();
            },
            "Creating product and attaching digital PDF",
          );
        } else {
          await skip(["product_copy", "product_qc", "shopify_draft", "shopify_verify"], "Shopify draft already uploaded");
        }

        // Optional auto-publish
        if (autoPublish && ebook.shopify_product_id && ebook.shopify_status === "draft") {
          await runStep("13_publish", "shopify-publish", { ebook_id: ebook.id });
        }

        await db.from("ebooks").update({
          autopilot_state: autoPublish ? "done" : "ready_to_publish",
          needs_review_reason: null,
        }).eq("id", ebook.id);

        await logRun(db, {
          ebook_id: ebook.id, step: "pipeline_complete", status: "ok",
          duration_ms: Date.now() - t0,
          payload: { mode, auto_publish: autoPublish, shopify_draft: shopifyDraftEnabled },
        });

        await tracker.complete({
          ebook_id: ebook.id,
          title: ebook.title,
          pdf_url: ebook.pdf_url,
          cover_url: ebook.cover_url,
          shopify_product_id: ebook.shopify_product_id,
          shopify_status: ebook.shopify_status,
          final_quality_score: ebook.final_quality_score,
          conversion_score: ebook.conversion_score,
          compliance_safety_score: ebook.compliance_safety_score,
          duration_ms: Date.now() - t0,
          auto_publish: autoPublish,
        });

        async function refreshEbook() {
          const { data } = await db.from("ebooks").select("*").eq("id", ebook.id).maybeSingle();
          if (data) ebook = data;
        }
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        console.error("autopilot-pipeline failed:", e);
        if (msg === "paused_by_admin") {
          await logRun(db, { ebook_id: ebook?.id, idea_id: idea?.id, step: "pipeline", status: "skip", error: "paused by admin" });
          return;
        }
        if (ebook?.id) {
          await db.from("ebooks").update({
            autopilot_state: "failed",
            needs_review_reason: msg.slice(0, 400),
          }).eq("id", ebook.id);
          await markQueueFailed(db, ebook.id, "pipeline", msg);
        }
        await logRun(db, { ebook_id: ebook?.id, idea_id: idea?.id, step: "pipeline", status: "fail", error: msg });
        // Surface failure on the live run too.
        try {
          await db.from("autopilot_pipeline_runs").update({
            status: "failed",
            failed_at: new Date().toISOString(),
            error_message: msg.slice(0, 800),
            current_action_message: `Pipeline failed: ${msg.slice(0, 200)}`,
          }).eq("id", run_id);
        } catch { /* ignore */ }
      }
    })();

    // @ts-ignore — EdgeRuntime is provided by Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(pipeline);

    return json({
      ok: true, async: true, mode, ebook_id, idea_id, run_id,
      auto_publish: autoPublish, shopify_draft_enabled: shopifyDraftEnabled,
    });
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function invokeFn(name: string, body: unknown): Promise<InvokeResult> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* ignore */ }
  return { ok: resp.ok, status: resp.status, body: parsed ?? { raw: text.slice(0, 400) } };
}
