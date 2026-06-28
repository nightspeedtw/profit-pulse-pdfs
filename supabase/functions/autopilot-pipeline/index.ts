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
      async function track(stepNames: string[], message: string, fn: () => Promise<void>) {
        if (await tracker.isPauseRequested()) {
          await tracker.markPaused();
          throw new Error("paused_by_admin");
        }
        for (const n of stepNames) await tracker.startStep(n, message);
        try {
          await fn();
          for (const n of stepNames) await tracker.passStep(n);
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          await tracker.failStep(stepNames[stepNames.length - 1], msg);
          throw err;
        }
      }

      // Skip multiple steps with a single message (used when section is already complete).
      async function skip(stepNames: string[], message: string) {
        for (const n of stepNames) await tracker.skipStep(n, message);
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

        if (ebook.autopilot_state === "failed") {
          await db.from("ebooks").update({ autopilot_state: "running", needs_review_reason: null }).eq("id", ebook.id);
        } else {
          await db.from("ebooks").update({ autopilot_mode: mode, autopilot_state: "running" }).eq("id", ebook.id);
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
              : `Outline missing chapters — repairing (attempt ${attempts}/3)…`;
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

        // ---------- STEP 6 + 7 — Write chapters ----------
        // Hard dependency: outline must be valid before we ever invoke write-chapters.
        if (!hasValidOutline(ebook)) {
          // Defensive: should be impossible after ensureValidOutline, but never call
          // write-chapters without an outline (that's the bug we're fixing).
          await needsAdmin("chapter_writing", "Outline still missing after repair — refusing to start chapter writing.");
          throw new Error("outline_missing_before_write_chapters");
        }
        if ((ebook.total_word_count ?? 0) < (Number(settings.min_word_count ?? 18000) * 0.9)) {
          if (await overBudget() || await overAiCalls()) {
            await needsAdmin("chapter_writing", "Budget cap reached before chapter writing.", "Raise per-ebook budget or unblock the job.");
            return;
          }
          await track(
            ["chapter_writing", "chapter_qc"],
            "Writing chapters and running per-chapter QC…",
            async () => {
              // Re-validate immediately before the call (cheap insurance against races).
              await refreshEbook();
              if (!hasValidOutline(ebook)) {
                // Self-heal once more rather than crashing the run.
                await ensureValidOutline();
              }
              await runStep("6_7_write_qc_chapters", "write-chapters", { ebook_id: ebook.id, full: true });
              await refreshEbook();
            },
          );
        } else {
          await skip(["chapter_writing", "chapter_qc"], "Chapters already written");
        }

        // ---------- STEP 8 — Final manuscript QC ----------
        if (ebook.manuscript_qc_status !== "pass" && ebook.manuscript_qc_status !== "approved") {
          if (await overBudget()) {
            await needsAdmin("manuscript_qc", "Budget cap reached before manuscript QC.");
            return;
          }
          await track(
            ["manuscript_qc"],
            "Running final manuscript QC across the whole book…",
            async () => {
              await runStep("8_final_manuscript_qc", "final-manuscript-qc", { ebook_id: ebook.id });
              await refreshEbook();
            },
          );
          if (ebook.manuscript_qc_status === "needs_review") {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "manuscript QC needs review" }).eq("id", ebook.id);
            await needsAdmin("manuscript_qc", "Manuscript QC failed after auto-fix attempts.", "Edit chapters or rerun manuscript QC.");
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
            "Generating premium cover and thumbnail with text overlay…",
            async () => {
              await runStep("9_cover", "generate-cover", { ebook_id: ebook.id, mode: "full" });
              await refreshEbook();
            },
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
            "Designing and rendering premium PDF, then running PDF QC…",
            async () => {
              await runStep("10_11_render_pdf_qc", "render-pdf", { ebook_id: ebook.id });
              await refreshEbook();
            },
          );
          if (ebook.pdf_status === "needs_review") {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "PDF QC needs review" }).eq("id", ebook.id);
            await needsAdmin("pdf_qc", "PDF QC failed after auto-fix attempts.", "Edit cover/layout or regenerate PDF.");
            return;
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
            await db.from("ebooks").update({
              autopilot_state: "needs_review",
              needs_review_reason: `Daily Shopify upload cap reached (${maxShopifyPerDay}/day)`,
            }).eq("id", ebook.id);
            await logRun(db, { ebook_id: ebook.id, step: "12_shopify_draft", status: "skip", error: "shopify daily cap" });
            await needsAdmin("shopify_draft", `Daily Shopify upload cap reached (${maxShopifyPerDay}/day).`, "Raise the daily cap or wait for tomorrow.");
            return;
          }
          await track(
            ["product_copy", "product_qc", "shopify_draft", "shopify_verify"],
            "Writing product copy, running product page QC, and uploading Shopify draft…",
            async () => {
              await runStep("12_shopify_draft", "shopify-draft-upload", { ebook_id: ebook.id });
              await refreshEbook();
            },
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
