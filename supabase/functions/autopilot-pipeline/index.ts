// Milestone 8 — Autopilot Pipeline (12-step).
//
// POST { idea_id?, ebook_id?, mode? }
// Drives the full A-Z pipeline using the Milestone-3..7 functions in order:
//   1. Generate topic           (generate-idea)             — only when no idea_id supplied
//   2. Generate best title      (idea-copywriter)
//   3. QC idea                  (already inline in idea-copywriter / promote-idea)
//   4. Generate outline         (generate-outline)          — Milestone 3
//   5. QC outline               (auto-loop inside generate-outline)
//   6. Write chapters           (write-chapters)            — Milestone 3
//   7. QC chapters              (auto-loop per chapter inside write-chapters)
//   8. Run final manuscript QC  (final-manuscript-qc)       — Milestone 4
//   9. Generate cover           (generate-cover)            — Milestone 5
//   10. Generate PDF            (render-pdf)                — Milestone 6
//   11. Run final PDF QC        (auto-run inside render-pdf)
//   12. Create Shopify draft    (shopify-draft-upload)      — Milestone 7
//
// Safe mode  → stops after the Shopify draft (auto-publish OFF).
// Full mode  → additionally calls shopify-publish IF auto_publish=true AND publishGate passes.
//
// Respects generation_settings: daily_quota, daily_budget_usd, per_ebook_budget_usd,
// auto_rewrite_limit, paused, shopify_draft_upload_enabled, auto_publish, category_mix.
//
// Idempotent: re-invoking with the same ebook_id skips already-completed steps.
import { admin, corsHeaders } from "../_shared/ai.ts";
import { logRun } from "../_shared/qc.ts";

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
    if (settings.paused) return json({ skipped: "autopilot paused" });

    mode = mode ?? settings.autopilot_mode ?? "safe";
    const autoPublish: boolean = !!settings.auto_publish && mode === "full";
    const shopifyDraftEnabled: boolean = settings.shopify_draft_upload_enabled !== false;
    const perEbookBudget = Number(settings.per_ebook_budget_usd ?? 2);
    const dailyBudget = Number(settings.daily_budget_usd ?? 5);

    // ---- Daily-budget guard ----
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { data: dayCosts } = await db.from("cost_log").select("cost_usd").gte("created_at", dayStart.toISOString());
    const spent = (dayCosts ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
    if (spent >= dailyBudget) {
      return json({ skipped: `daily budget exhausted ($${spent.toFixed(2)} ≥ $${dailyBudget})` });
    }

    // ---- Pipeline (background) ----
    const pipeline = (async () => {
      let ebook: any = null;
      let idea: any = null;
      try {
        // STEP 1 — Generate topic if no input
        if (!idea_id && !ebook_id) {
          const gen = await invokeFn("generate-idea", { count: 1, category_mix: settings.category_mix ?? null });
          idea_id = gen.body?.ideas?.[0]?.id ?? gen.body?.id;
          await logRun(db, { step: "1_generate_topic", status: gen.ok ? "ok" : "fail", payload: { idea_id } });
          if (!idea_id) throw new Error("generate-idea returned no idea");
        }

        // STEP 2 + 3 — Generate best title + QC idea (idea-copywriter)
        if (idea_id) {
          const { data: i } = await db.from("ebook_ideas").select("*").eq("id", idea_id).maybeSingle();
          idea = i;
          if (idea && (idea.premium_score == null || (idea.title_rewrite_count ?? 0) === 0)) {
            const r = await invokeFn("idea-copywriter", { idea_id });
            await logRun(db, { idea_id, step: "2_best_title_qc", status: r.ok ? "ok" : "fail", payload: r.body });
            const { data: i2 } = await db.from("ebook_ideas").select("*").eq("id", idea_id).maybeSingle();
            idea = i2;
            if (idea?.status === "rejected") {
              await logRun(db, { idea_id, step: "qc_idea", status: "reject", error: idea.auto_rejected_reason });
              return; // hard stop — idea failed QC
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

        await db.from("ebooks").update({
          autopilot_mode: mode,
          autopilot_state: "running",
        }).eq("id", ebook.id);

        const overBudget = async () => {
          const { data: c } = await db.from("cost_log").select("cost_usd").eq("ebook_id", ebook.id);
          const ec = (c ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
          if (ec >= perEbookBudget) {
            await db.from("ebooks").update({
              autopilot_state: "needs_review",
              needs_review_reason: `per-ebook budget exceeded ($${ec.toFixed(2)} ≥ $${perEbookBudget})`,
            }).eq("id", ebook.id);
            return true;
          }
          return false;
        };

        // STEP 4 + 5 — Outline + QC
        if (!ebook.outline_json && !(ebook.toc && Array.isArray(ebook.toc) && ebook.toc.length)) {
          if (await overBudget()) return;
          const r = await invokeFn("generate-outline", { ebook_id: ebook.id });
          await logRun(db, { ebook_id: ebook.id, step: "4_5_outline_qc", status: r.ok ? "ok" : "fail", payload: r.body });
          await refreshEbook();
          if (ebook.writing_status === "outline_rejected") {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "outline QC failed" }).eq("id", ebook.id);
            return;
          }
        }

        // STEP 6 + 7 — Write chapters with per-chapter QC
        if ((ebook.total_word_count ?? 0) < (Number(settings.min_word_count ?? 18000) * 0.9)) {
          if (await overBudget()) return;
          const r = await invokeFn("write-chapters", { ebook_id: ebook.id, full: true });
          await logRun(db, { ebook_id: ebook.id, step: "6_7_write_qc_chapters", status: r.ok ? "ok" : "fail", payload: { word_count: r.body?.total_word_count } });
          await refreshEbook();
        }

        // STEP 8 — Final manuscript QC (Milestone 4)
        if (ebook.manuscript_qc_status !== "pass" && ebook.manuscript_qc_status !== "approved") {
          if (await overBudget()) return;
          const r = await invokeFn("final-manuscript-qc", { ebook_id: ebook.id });
          await logRun(db, { ebook_id: ebook.id, step: "8_final_manuscript_qc", status: r.ok ? "ok" : "fail", payload: r.body });
          await refreshEbook();
          if (ebook.manuscript_qc_status === "needs_review") {
            await db.from("ebooks").update({ autopilot_state: "needs_review", needs_review_reason: "manuscript QC needs review" }).eq("id", ebook.id);
            return;
          }
        }

        // STEP 9 — Cover
        if (!ebook.cover_url) {
          if (await overBudget()) return;
          const r = await invokeFn("generate-cover", { ebook_id: ebook.id, mode: "full" });
          await logRun(db, { ebook_id: ebook.id, step: "9_cover", status: r.ok ? "ok" : "fail", payload: r.body });
          await refreshEbook();
        }
        // In safe mode the cover must be admin-approved before continuing.
        if (mode === "safe" && !ebook.cover_approved) {
          await db.from("ebooks").update({
            autopilot_state: "awaiting_cover_approval",
            needs_review_reason: "Cover awaiting admin approval (Safe Autopilot)",
          }).eq("id", ebook.id);
          await logRun(db, { ebook_id: ebook.id, step: "safe_gate_cover", status: "skip", error: "awaiting cover approval" });
          return;
        }

        // STEP 10 + 11 — Render PDF + auto PDF QC (Milestone 6)
        if (!ebook.pdf_url || ebook.pdf_status === "needs_review" || ebook.pdf_status === "failed") {
          if (await overBudget()) return;
          const r = await invokeFn("render-pdf", { ebook_id: ebook.id });
          await logRun(db, { ebook_id: ebook.id, step: "10_11_render_pdf_qc", status: r.ok ? "ok" : "fail", payload: { passed: r.body?.passed, score: r.body?.qc?.final_pdf_premium_score } });
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
          const r = await invokeFn("shopify-draft-upload", { ebook_id: ebook.id });
          await logRun(db, { ebook_id: ebook.id, step: "12_shopify_draft", status: r.ok ? "ok" : "fail", payload: r.body });
          await refreshEbook();
        }

        // Optional auto-publish — Full mode + auto_publish=true only.
        if (autoPublish && ebook.shopify_product_id && ebook.shopify_status === "draft") {
          const r = await invokeFn("shopify-publish", { ebook_id: ebook.id });
          await logRun(db, { ebook_id: ebook.id, step: "13_publish", status: r.ok ? "ok" : "fail", payload: r.body });
        }

        await db.from("ebooks").update({
          autopilot_state: autoPublish ? "done" : "ready_to_publish",
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
