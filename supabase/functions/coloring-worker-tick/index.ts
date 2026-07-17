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
import { readLaneGuards, sumFalSpendToday, DEFAULT_FAL_DAILY_BUDGET_USD, patchLaneCfg, clearProviderBillingBlocked } from "../_shared/fal-billing.ts";
import { readCfBillingLockedUntil } from "../_shared/image-providers.ts";
import { fireAndForgetPost } from "../_shared/coloring/self-advance.ts";

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

    // Lane-level provider guards.
    // v2 (per-provider): a single provider being billing_blocked is NOT
    // grounds to freeze the whole tick — the failover dispatcher in
    // image-providers.ts will route around it. We only halt when the
    // FAL daily-BUDGET cap has been reached (spend safety, not health).
    const guards = await readLaneGuards(db);
    result.provider_billing_blocked = guards.provider_billing_blocked;

    // ── AUTO-CLEAR CF LATCH ON NEW UTC DAY ─────────────────────────────
    // Cloudflare's neuron pool resets at 00:00 UTC. If the latch time has
    // passed, clear the per-provider billing_blocked.cloudflare flag so
    // the failover dispatcher considers CF healthy again this tick.
    const cfLatch = await readCfBillingLockedUntil(db);
    if (!cfLatch && guards.provider_billing_blocked.cloudflare?.active) {
      try { await clearProviderBillingBlocked(db, "cloudflare"); result.cf_latch_cleared = true; } catch (_e) { /* best-effort */ }
    }

    // ── WAKE SWEEP: parked (awaiting_*) rows whose next_retry_at arrived ─
    // Coloring books parked with a scheduled wake time get requeued the
    // moment their provider is healthy again. This is the class fix for
    // "book sits silently in blocker_reason with no scheduled retry".
    const nowIso = new Date().toISOString();
    const { data: parkedRows } = await db
      .from("ebooks_kids")
      .select("id, pipeline_status, next_retry_at")
      .eq("book_type", "coloring_book")
      .in("pipeline_status", ["awaiting_quota_reset", "awaiting_billing"])
      .lte("next_retry_at", nowIso)
      .limit(20);
    const woken: unknown[] = [];
    const stillWaiting: unknown[] = [];
    for (const row of parkedRows ?? []) {
      const cfHealthy = !cfLatch && !guards.provider_billing_blocked.cloudflare?.active;
      const falHealthy = !guards.provider_billing_blocked.fal?.active;
      // At least one provider must be healthy to wake — otherwise re-park
      // with a fresh wake time so we don't burn a dispatch.
      if (!cfHealthy && !falHealthy) {
        stillWaiting.push({ ebook_id: row.id, reason: "both_providers_still_dry" });
        continue;
      }
      await db.from("ebooks_kids").update({
        pipeline_status: "queued",
        blocker_reason: null,
        next_retry_at: null,
      }).eq("id", row.id);
      woken.push({ ebook_id: row.id, from: row.pipeline_status, cf_healthy: cfHealthy, fal_healthy: falHealthy });
    }
    result.woken = woken;
    result.still_waiting = stillWaiting;

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

    // Focus mode: when a stage self-advances it passes `ebook_id`; we
    // dispatch only that row (still respecting the parallelism cap above)
    // and skip the general queue scan. This is the class fix for "books
    // park between stages waiting for the next cron tick".
    const focusEbookId = typeof body.ebook_id === "string" ? body.ebook_id : null;
    let queued: any[] = [];
    if (focusEbookId) {
      const { data: row } = await db
        .from("ebooks_kids")
        .select("id, title, metadata, pdf_url, cover_url, pipeline_status, book_type")
        .eq("id", focusEbookId)
        .maybeSingle();
      if (row && row.book_type === "coloring_book" && row.pipeline_status === "queued") {
        queued = [row];
      } else {
        result.focus_skipped = { ebook_id: focusEbookId, status: row?.pipeline_status ?? "not_found" };
      }
    } else {
      const { data } = await db
        .from("ebooks_kids")
        .select("id, title, metadata, pdf_url, cover_url")
        .eq("book_type", "coloring_book")
        .eq("pipeline_status", "queued")
        .order("created_at", { ascending: true })
        .limit(slots);
      queued = data ?? [];
    }
    result.queue_size = queued.length;
    result.focus = focusEbookId;

    // Route each queued coloring row to the correct stage based on `awaiting`:
    //   'cover_pdf_publish'          → coloring-book-cover (chains → assemble → publish)
    //   'publish'                    → coloring-book-publish
    //   otherwise                    → coloring-book-render (interior)
    //
    // Dispatch is FIRE-AND-FORGET (3s timeout treated as dispatched). A
    // dispatcher must never wait for the work it dispatches — otherwise the
    // gateway wall-clock kills the tick and books stall mid-stage.
    const dispatchPromises = queued.map(async (row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const awaiting = meta.awaiting as string | undefined;
      let target = "coloring-book-render";
      if (awaiting === "cover_pdf_publish") {
        target = row.cover_url ? (row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble") : "coloring-book-cover";
      } else if (awaiting === "publish" || awaiting === "publish_candidate" || awaiting === "owner_final_verification") {
        target = row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble";
      }
      const outcome = await fireAndForgetPost(
        `${url}/functions/v1/${target}`,
        { Authorization: `Bearer ${service}`, apikey: service },
        { ebook_id: row.id, ...(awaiting === "publish_candidate" || awaiting === "owner_final_verification" ? { mode: "candidate" } : {}) },
        3_000,
      );
      return {
        ebook_id: row.id, title: row.title, target,
        dispatched: outcome.dispatched, status: outcome.status ?? null, note: outcome.error ?? null,
      };
    });
    const dispatchResults = await Promise.all(dispatchPromises);
    (result.dispatched as unknown[]).push(...dispatchResults);

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
