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

interface InvokeResult { ok: boolean; status: number; body: any; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    let { idea_id, ebook_id, mode } = body as { idea_id?: string; ebook_id?: string; mode?: string };

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

      try {
        // STEP 1 — generate topic if no input
        if (!idea_id && !ebook_id) {
          const gen = await runStep("1_generate_topic", "generate-idea", { count: 1, category_mix: settings.category_mix ?? null });
          idea_id = gen.body?.ids?.[0] ?? gen.body?.ideas?.[0]?.id ?? gen.body?.id;
          if (!idea_id) throw new Error("generate-idea returned no idea");
        }

        // STEP 2 + 3 — best title + QC idea
        if (idea_id) {
          const { data: i } = await db.from("ebook_ideas").select("*").eq("id", idea_id).maybeSingle();
          idea = i;
          if (idea && (idea.premium_score == null || (idea.title_rewrite_count ?? 0) === 0)) {
            await runStep("2_best_title_qc", "idea-copywriter", { idea_id });
            const { data: i2 } = await db.from("ebook_ideas").select("*").eq("id", idea_id).maybeSingle();
            idea = i2;
            if (idea?.status === "rejected") {
              await logRun(db, { idea_id, step: "qc_idea", status: "reject", error: idea.auto_rejected_reason });
              return;
            }
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

        // Reset previous failure if user clicked "Resume".
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

        // STEP 4 + 5 — Outline + QC
        if (!ebook.outline_json && !(ebook.toc && Array.isArray(ebook.toc) && ebook.toc.length)) {
          if (await overBudget() || await overAiCalls()) return;
          await runStep("4_5_outline_qc", "generate-outline", { ebook_id: ebook.id });
          await refreshEbook();
          if (ebook.writing_status === "outline_rejected") {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "outline QC failed" }).eq("id", ebook.id);
            return;
          }
        }

        // STEP 6 + 7 — Write chapters with per-chapter QC
        if ((ebook.total_word_count ?? 0) < (Number(settings.min_word_count ?? 18000) * 0.9)) {
          if (await overBudget() || await overAiCalls()) return;
          await runStep("6_7_write_qc_chapters", "write-chapters", { ebook_id: ebook.id, full: true });
          await refreshEbook();
        }

        // STEP 8 — Final manuscript QC
        if (ebook.manuscript_qc_status !== "pass" && ebook.manuscript_qc_status !== "approved") {
          if (await overBudget()) return;
          await runStep("8_final_manuscript_qc", "final-manuscript-qc", { ebook_id: ebook.id });
          await refreshEbook();
          if (ebook.manuscript_qc_status === "needs_review") {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "manuscript QC needs review" }).eq("id", ebook.id);
            return;
          }
        }

        // STEP 9 — Cover
        if (!ebook.cover_url) {
          if (await overBudget()) return;
          await runStep("9_cover", "generate-cover", { ebook_id: ebook.id, mode: "full" });
          await refreshEbook();
        }
        if (mode === "safe" && !ebook.cover_approved) {
          await db.from("ebooks").update({
            autopilot_state: "awaiting_cover_approval",
            needs_review_reason: "Cover awaiting admin approval (Safe Autopilot)",
          }).eq("id", ebook.id);
          await logRun(db, { ebook_id: ebook.id, step: "safe_gate_cover", status: "skip", error: "awaiting cover approval" });
          return;
        }

        // STEP 10 + 11 — Render PDF (auto QC inside)
        if (!ebook.pdf_url || ebook.pdf_status === "needs_review" || ebook.pdf_status === "failed") {
          if (await overBudget()) return;
          await runStep("10_11_render_pdf_qc", "render-pdf", { ebook_id: ebook.id });
          await refreshEbook();
          if (ebook.pdf_status === "needs_review") {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "PDF QC needs review" }).eq("id", ebook.id);
            return;
          }
        }
        if (mode === "safe" && !ebook.pdf_approved) {
          await db.from("ebooks").update({
            autopilot_state: "awaiting_pdf_approval",
            needs_review_reason: "PDF awaiting admin approval (Safe Autopilot)",
          }).eq("id", ebook.id);
          await logRun(db, { ebook_id: ebook.id, step: "safe_gate_pdf", status: "skip", error: "awaiting PDF approval" });
          return;
        }

        // STEP 12 — Shopify draft upload
        if (shopifyDraftEnabled && !ebook.shopify_product_id) {
          if (await shopifyOverDay()) {
            await db.from("ebooks").update({
              autopilot_state: "needs_review",
              needs_review_reason: `Daily Shopify upload cap reached (${maxShopifyPerDay}/day)`,
            }).eq("id", ebook.id);
            await logRun(db, { ebook_id: ebook.id, step: "12_shopify_draft", status: "skip", error: "shopify daily cap" });
            return;
          }
          await runStep("12_shopify_draft", "shopify-draft-upload", { ebook_id: ebook.id });
          await refreshEbook();
        }

        // Optional auto-publish — Full mode + auto_publish=true only.
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

        async function refreshEbook() {
          const { data } = await db.from("ebooks").select("*").eq("id", ebook.id).maybeSingle();
          if (data) ebook = data;
        }
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        console.error("autopilot-pipeline failed:", e);
        if (ebook?.id) {
          await db.from("ebooks").update({
            autopilot_state: "failed",
            needs_review_reason: msg.slice(0, 400),
          }).eq("id", ebook.id);
          await markQueueFailed(db, ebook.id, "pipeline", msg);
        }
        await logRun(db, { ebook_id: ebook?.id, idea_id: idea?.id, step: "pipeline", status: "fail", error: msg });
      }
    })();

    // @ts-ignore — EdgeRuntime is provided by Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(pipeline);

    return json({
      ok: true, async: true, mode, ebook_id, idea_id,
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
