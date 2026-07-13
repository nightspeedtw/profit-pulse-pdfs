// Autopilot orchestrator — Kids track.
//
// Pipeline: story bible + manuscript → visual bible → render PDF (which also
// generates per-spread illustrations via _shared/kids-visual-bible + illustration-planner)
// → cover (kids template) → store thumbnail (passthrough) → Shopify draft → publish.
//
// Isolated from the adult track: shares no prompt, no QC gate, no cover template.
// Guards against being called on adult ebooks (returns wrong-track response).
//
// Idempotent: called with { ebook_id }, resumes from ebooks.autopilot_state.

import { corsHeaders, admin, requireAdmin, logCost } from "../_shared/ai.ts";
import { resolveTrack, wrongTrackResponse } from "../_shared/track-registry.ts";
import { kidsPublishGate } from "../_shared/qc/kids.ts";

async function callFn(name: string, body: unknown, authToken: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function logStep(
  db: ReturnType<typeof admin>,
  ebook_id: string,
  step: string,
  status: "ok" | "fail" | "skipped",
  extra: Record<string, unknown> = {},
) {
  try {
    await db.from("pipeline_step_logs").insert({
      ebook_id,
      step,
      status,
      track: "kids",
      payload: extra as any,
    });
  } catch (_) {
    // fall back if column shape differs — never break the pipeline for logging
    console.log("kids-log", ebook_id, step, status, extra);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id, mode = "safe" } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");

    const { data: ebook } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!ebook) throw new Error("Ebook not found");

    // Track guard — refuse to touch adult ebooks.
    let categorySlug: string | null = null;
    if (ebook.category_id) {
      const { data: cat } = await db.from("categories").select("slug").eq("id", ebook.category_id).maybeSingle();
      categorySlug = cat?.slug ?? null;
    }
    const track = resolveTrack(ebook as any, categorySlug);
    if (track !== "kids") {
      console.log("autopilot-kids: refusing non-kids ebook", { ebook_id, track });
      return wrongTrackResponse(ebook_id, "kids", track, corsHeaders, "autopilot-kids");
    }

    const auth = req.headers.get("Authorization")!.replace("Bearer ", "");

    const stamp = async (state: string, patch: Record<string, unknown> = {}) => {
      await db.from("ebooks").update({ autopilot_state: state, autopilot_mode: mode, ...patch }).eq("id", ebook_id);
    };

    const pipeline = (async () => {
      try {
        // ---------- STEP 1: MANUSCRIPT (14-spread picture book) ----------
        if (!ebook.kids_scene_briefs_json) {
          await stamp("kids_manuscript");
          await callFn("rewrite-kids-manuscript", { ebook_id }, auth);
          await logStep(db, ebook_id, "kids_manuscript", "ok");
        }

        // ---------- STEP 2: RENDER PDF (generates visual bible + per-spread art) ----------
        await stamp("kids_render_pdf");
        await callFn("render-pdf", { ebook_id }, auth);
        await logStep(db, ebook_id, "kids_render_pdf", "ok");

        // ---------- STEP 3: COVER (kids template — hero illustration) ----------
        const { data: e2 } = await db.from("ebooks").select("cover_url").eq("id", ebook_id).single();
        if (!e2?.cover_url) {
          await stamp("kids_cover");
          await callFn("generate-cover", { ebook_id }, auth);
          await logStep(db, ebook_id, "kids_cover", "ok");
        }

        // ---------- STEP 4: STORE THUMBNAIL (passthrough for kids) ----------
        await stamp("kids_thumbnail");
        try {
          await callFn("generate-store-thumbnail", { ebook_id }, auth);
          await logStep(db, ebook_id, "kids_thumbnail", "ok");
        } catch (e) {
          await logStep(db, ebook_id, "kids_thumbnail", "fail", { error: String(e) });
        }

        // ---------- STEP 5: SHOPIFY DRAFT ----------
        await stamp("kids_shopify_draft");
        try {
          await callFn("push-to-shopify", { ebook_id }, auth);
          await db.from("ebooks").update({ shopify_status: "draft" }).eq("id", ebook_id);
          await logStep(db, ebook_id, "kids_shopify_draft", "ok");
        } catch (e) {
          await db.from("ebooks").update({
            shopify_status: "failed",
            needs_review_reason: `shopify upload failed: ${String(e).slice(0, 200)}`,
            autopilot_state: "needs_review",
          }).eq("id", ebook_id);
          await logStep(db, ebook_id, "kids_shopify_draft", "fail", { error: String(e) });
          return;
        }

        // ---------- STEP 6: PUBLISH GATE ----------
        const { data: fresh } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
        const kidsQc = (fresh?.kids_visual_bible as any)?.qc_scores ?? {};
        const gate = kidsPublishGate(kidsQc);
        await logStep(db, ebook_id, "kids_publish_gate", gate.pass ? "ok" : "fail", { reasons: gate.reasons });

        if (mode === "full" && gate.pass) {
          try {
            await callFn("shopify-publish", { ebook_id }, auth);
            await db.from("ebooks").update({
              shopify_status: "published", status: "published", autopilot_state: "done",
            }).eq("id", ebook_id);
            await logStep(db, ebook_id, "kids_publish", "ok");
          } catch (e) {
            await db.from("ebooks").update({
              autopilot_state: "needs_review",
              needs_review_reason: `kids publish failed: ${String(e).slice(0, 200)}`,
            }).eq("id", ebook_id);
            await logStep(db, ebook_id, "kids_publish", "fail", { error: String(e) });
          }
        } else {
          await db.from("ebooks").update({
            autopilot_state: gate.pass ? "ready_to_publish" : "needs_review",
            needs_review_reason: gate.pass ? null : gate.reasons.join("; "),
            status: gate.pass ? "uploaded" : "needs_review",
          }).eq("id", ebook_id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("autopilot-kids pipeline failed:", err);
        await db.from("ebooks").update({
          autopilot_state: "failed",
          needs_review_reason: msg.slice(0, 400),
        }).eq("id", ebook_id);
        await logStep(db, ebook_id, "kids_pipeline", "fail", { error: msg });
      }
    })();

    // @ts-ignore EdgeRuntime is available in Supabase runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(pipeline);

    return new Response(JSON.stringify({ ok: true, track: "kids", ebook_id, mode }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("autopilot-kids error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
