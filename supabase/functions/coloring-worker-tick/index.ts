// coloring-worker-tick — the DEDICATED dispatcher for the coloring queue.
// Scans book_type='coloring_book' + pipeline_status='queued', respects
// coloring-only pause + parallelism cap, and hands each row to
// coloring-book-render. Independent of picture-book state.
//
// Body: { manual?: boolean, passcode?: string }

// @ts-nocheck
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { CURRENT_COLORING_REPAIR_REGIME } from "../_shared/coloring/repair-regime.ts";
import { readLaneGuards, sumFalSpendToday, DEFAULT_FAL_DAILY_BUDGET_USD, patchLaneCfg } from "../_shared/fal-billing.ts";

declare const Deno: any;

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
};

const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });
  const result: Record<string, unknown> = { tick_at: new Date().toISOString(), dispatched: [] };

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* cron */ }
    const manual = !!body.manual;
    if (manual) {
      const supplied = req.headers.get("x-admin-passcode") ?? body?.passcode ?? "";
      if (supplied !== PASSCODE) return json({ error: "unauthenticated" }, 401);
    }

    const { data: gs } = await db
      .from("generation_settings").select("coloring_autopilot").eq("id", 1).maybeSingle();
    const cfg = gs?.coloring_autopilot ?? {};
    if (cfg.paused) {
      result.skipped = "engine_paused";
      await recordTick(db, result);
      return json(result);
    }

    // Lane-level provider guards — never dispatch into a locked account or
    // over the daily FAL budget cap. These are class fixes, not per-book.
    const guards = await readLaneGuards(db);
    if (guards.billing_blocked.active) {
      result.skipped = "provider_billing_locked";
      result.billing_blocked = guards.billing_blocked;
      await recordTick(db, result);
      return json(result);
    }
    const cap = Number((guards.cfg.fal_daily_budget_usd as number | undefined) ?? DEFAULT_FAL_DAILY_BUDGET_USD);
    if (cap > 0) {
      const spent = await sumFalSpendToday(db);
      result.fal_spent_today_usd = Number(spent.toFixed(4));
      result.fal_daily_cap_usd = cap;
      if (spent >= cap) {
        await patchLaneCfg(db, {
          fal_budget_cap: {
            reached: true, spent_usd: spent, cap_usd: cap,
            day_utc: new Date().toISOString().slice(0, 10),
            at: new Date().toISOString(),
          },
        });
        result.skipped = "fal_budget_cap_reached";
        await recordTick(db, result);
        return json(result);
      }
    }

    const maxParallel = Math.max(1, Number(cfg.max_parallel ?? 1));
    const { count: inFlight } = await db
      .from("ebooks_kids")
      .select("id", { count: "exact", head: true })
      .eq("book_type", "coloring_book")
      .eq("pipeline_status", "generating");
    result.in_flight = inFlight ?? 0;
    const slots = Math.max(0, maxParallel - (inFlight ?? 0));
    result.slots = slots;
    if (slots === 0) {
      result.skipped = "at_parallelism_cap";
      await recordTick(db, result);
      return json(result);
    }

    // ── WATCHDOG: auto-requeue failed rows under a newer repair regime ──
    // Class fix: when learn-then-retry stamps a new regime, dead rows must
    // be requeued exactly once per regime version — never rest silently in
    // 'failed'. Reset attempts for dead pages, stamp the version, flip to
    // 'queued', clear blocker. The queued scan below then dispatches them.
    const { data: failedRows } = await db
      .from("ebooks_kids")
      .select("id, title, metadata")
      .eq("book_type", "coloring_book")
      .eq("pipeline_status", "failed")
      .limit(20);
    const requeued: unknown[] = [];
    for (const row of failedRows ?? []) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const lastVer = meta.coloring_last_requeued_regime_version as string | undefined;
      if (lastVer === CURRENT_COLORING_REPAIR_REGIME) continue;
      const deadPages = (meta.coloring_dead_pages as number[] | undefined) ?? [];
      const attempts = ((meta.coloring_repair_attempts as Record<string, number> | undefined) ?? {});
      for (const p of deadPages) attempts[String(p)] = 0;
      const mergedMeta = {
        ...meta,
        coloring_repair_attempts: attempts,
        coloring_last_requeued_regime_version: CURRENT_COLORING_REPAIR_REGIME,
        coloring_regime_version: CURRENT_COLORING_REPAIR_REGIME,
        coloring_last_requeued_at: new Date().toISOString(),
        coloring_current_step_label:
          `Auto-requeue under regime ${CURRENT_COLORING_REPAIR_REGIME} (dead: ${deadPages.join(", ") || "none"})`,
        awaiting: meta.awaiting === "cover_pdf_publish" || meta.awaiting === "publish"
          ? meta.awaiting
          : "render",
      };
      await db.from("ebooks_kids").update({
        pipeline_status: "queued",
        blocker_reason: null,
        metadata: mergedMeta,
      }).eq("id", row.id);
      requeued.push({ ebook_id: row.id, title: row.title, dead_pages: deadPages, regime: CURRENT_COLORING_REPAIR_REGIME });
    }
    result.watchdog_requeued = requeued;

    const { data: queued } = await db
      .from("ebooks_kids")
      .select("id, title, metadata, pdf_url, cover_url")
      .eq("book_type", "coloring_book")
      .eq("pipeline_status", "queued")
      .order("created_at", { ascending: true })
      .limit(slots);
    result.queue_size = queued?.length ?? 0;

    // Route each queued coloring row to the correct stage based on `awaiting`:
    //   'cover_pdf_publish'          → coloring-book-cover (chains → assemble → publish)
    //   'publish'                    → coloring-book-publish
    //   otherwise                    → coloring-book-render (interior)
    // NOTE: 'owner_calibration_review' and 'owner_final_verification' pins
    // are REMOVED — calibration is auto-approved by the gates and publish
    // is auto-chained. Any legacy row still carrying those awaits is routed
    // back to its natural stage (render or publish) so it flows without wait.
    for (const row of queued ?? []) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const awaiting = meta.awaiting as string | undefined;
      let target = "coloring-book-render";
      if (awaiting === "cover_pdf_publish") {
        target = row.cover_url ? (row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble") : "coloring-book-cover";
      } else if (awaiting === "publish" || awaiting === "publish_candidate" || awaiting === "owner_final_verification") {
        // owner_final_verification is a legacy human-hold pin — route to candidate.
        target = row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble";
      }
      // 'owner_calibration_review' legacy pin: fall through to coloring-book-render;
      // the render function will detect calibration-complete and auto-approve.
      const r = await fetch(`${url}/functions/v1/${target}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${service}`,
          apikey: service,
        },
        body: JSON.stringify({ ebook_id: row.id, ...(awaiting === "publish_candidate" || awaiting === "owner_final_verification" ? { mode: "candidate" } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      (result.dispatched as unknown[]).push({
        ebook_id: row.id, title: row.title, target, ok: r.ok, status: r.status,
        note: j?.note ?? j?.error ?? null,
      });
    }

    await recordTick(db, result);
    return json(result);
  } catch (e: any) {
    result.error = e?.message ?? String(e);
    await recordTick(db, result);
    return json(result, 500);
  }
});

async function recordTick(db: any, result: Record<string, unknown>) {
  try {
    const { data: gs } = await db.from("generation_settings").select("coloring_autopilot").eq("id", 1).maybeSingle();
    const merged = { ...(gs?.coloring_autopilot ?? {}), last_worker_tick_at: new Date().toISOString(), last_worker_tick_result: result };
    await db.from("generation_settings").update({ coloring_autopilot: merged }).eq("id", 1);
  } catch { /* non-fatal */ }
}

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
