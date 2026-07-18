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

// Module-scope singleton: warm invocations reuse this client (no pooler slot
// consumed — supabase-js uses PostgREST over HTTPS, not pgbouncer).
const _SB_URL = Deno.env.get("SUPABASE_URL")!;
const _SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(_SB_URL, _SB_KEY, { auth: { persistSession: false } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const result: Record<string, unknown> = { tick_at: new Date().toISOString(), dispatched: [] };
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

    // ── STUCK-'generating' WATCHDOG (defect class:
    // generating_status_zombie). A render invocation that dies mid-batch
    // (edge timeout, crashed vision verifier, killed worker) leaves the
    // row at pipeline_status='generating' with no self-invoke queued.
    // Without this rescue the row silently consumes a parallel slot
    // forever and cost_log shows paid provider calls with zero forward
    // progress. Threshold=15 min (well past any legitimate render batch
    // which caps around 3-5 min). Reset to 'queued' so the scan below
    // re-dispatches; the render function's incremental persist keeps any
    // pages that DID make it to metadata.
    const STUCK_GENERATING_MS = 15 * 60_000;
    const stuckCutoff = new Date(Date.now() - STUCK_GENERATING_MS).toISOString();
    const { data: zombies } = await db
      .from("ebooks_kids")
      .select("id, updated_at, metadata")
      .eq("book_type", "coloring_book")
      .eq("pipeline_status", "generating")
      .lt("updated_at", stuckCutoff)
      .limit(20);
    const revived: unknown[] = [];
    for (const z of zombies ?? []) {
      const zmeta = (z.metadata ?? {}) as Record<string, unknown>;
      await db.from("ebooks_kids").update({
        pipeline_status: "queued",
        blocker_reason: "zombie_generating_recovered",
        metadata: {
          ...zmeta,
          coloring_current_step_label:
            `Recovered from stuck 'generating' (updated_at ${z.updated_at}) — resuming render`,
          coloring_zombie_recoveries:
            ((zmeta.coloring_zombie_recoveries as number | undefined) ?? 0) + 1,
          coloring_last_zombie_recovery_at: new Date().toISOString(),
        },
      }).eq("id", z.id);
      revived.push({ ebook_id: z.id, was_updated_at: z.updated_at });
    }
    result.zombie_generating_revived = revived;

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
      // Fetch a larger candidate window so we can filter out rows we just
      // dispatched (cooldown) without starving the remaining queue when
      // the top-N are stuck bouncing on the same terminal-ish stage.
      const { data } = await db
        .from("ebooks_kids")
        .select("id, title, metadata, pdf_url, cover_url, blocker_reason")
        .eq("book_type", "coloring_book")
        .eq("pipeline_status", "queued")
        .order("created_at", { ascending: true })
        .limit(Math.max(slots * 6, 24));
      const now = Date.now();
      const COOLDOWN_MS = 90_000;
      // Owner ruling 2026-07-17: books parked on a lane-blocked provider
      // signal (billing exhausted / quota / provider_unavailable) must NOT
      // monopolize worker slots. They stay in `queued` for visibility but
      // are skipped by the dispatcher until the blocker_reason is cleared
      // by a code fix / lane recovery — same "never dead-end the whole
      // queue over one defect class" principle as the quota latch.
      const LANE_BLOCKED = /provider_billing|provider_quota|provider_unavailable|coloring_cover_retry_ceiling_reached/;
      // Cover-invocation ceiling: a limit that doesn't act is not a limit.
      // If cover invocations >= 5 and there's no cover_url yet, PARK the row
      // (stamp blocker_reason) and skip dispatch — regardless of whether
      // blocker_reason was previously cleared by a race, watchdog, or the
      // render/assemble path resetting it. This is the class fix for
      // "ceiling reached but no park" (known-regressions.md).
      const COVER_INVOCATION_CEILING = 5;
      let ceilingParked = 0;
      let laneBlockedSkipped = 0;
      const dispatchable: any[] = [];
      for (const r of (data ?? [])) {
        if (r.blocker_reason && LANE_BLOCKED.test(String(r.blocker_reason))) {
          laneBlockedSkipped += 1;
          continue;
        }
        const rMeta = (r.metadata ?? {}) as Record<string, unknown>;
        const invocations = Number(rMeta.coloring_cover_invocations ?? 0);
        const awaiting = rMeta.awaiting as string | undefined;
        const needsCover = !r.cover_url && (awaiting === "cover_pdf_publish" || awaiting == null);
        if (needsCover && invocations >= COVER_INVOCATION_CEILING) {
          const reason = `coloring_cover_retry_ceiling_reached:${invocations}`;
          try {
            await db.from("ebooks_kids").update({
              blocker_reason: reason,
              metadata: {
                ...rMeta,
                coloring_current_step_label:
                  `Cover retry ceiling reached (${invocations}/${COVER_INVOCATION_CEILING}) — parked by tick guard. Human must reset metadata.coloring_cover_invocations to resume.`,
                coloring_blocker: {
                  class: "non_recoverable_config",
                  reason,
                  invocations,
                  ceiling: COVER_INVOCATION_CEILING,
                  parked_by: "worker_tick_ceiling_guard",
                  detected_at: new Date().toISOString(),
                },
                awaiting: "human_review",
              },
            }).eq("id", r.id);
          } catch (_e) { /* best-effort */ }
          ceilingParked += 1;
          continue;
        }
        dispatchable.push(r);
      }
      result.cover_ceiling_parked = ceilingParked;

      const filtered = dispatchable.filter((r: any) => {
        const t = (r.metadata as any)?.coloring_last_dispatched_at;
        if (!t) return true;
        const ts = Date.parse(t);
        return !Number.isFinite(ts) || (now - ts) > COOLDOWN_MS;
      });
      // Focus-run priority: rows tagged with metadata.focus_run jump the queue
      // so a single high-QC book can complete today without waiting behind the
      // learning-mode backlog. Stable within each priority band.
      filtered.sort((a: any, b: any) => {
        const af = (a.metadata as any)?.focus_run ? 1 : 0;
        const bf = (b.metadata as any)?.focus_run ? 1 : 0;
        return bf - af;
      });
      queued = filtered.slice(0, slots);
      result.candidates_seen = (data ?? []).length;
      result.lane_blocked_skipped = laneBlockedSkipped;
      result.cooldown_skipped = dispatchable.length - filtered.length;
      result.focus_run_prioritized = queued.filter((r: any) => (r.metadata as any)?.focus_run).length;
    }
    result.queue_size = queued.length;
    result.focus = focusEbookId;

    // Route each queued coloring row to the correct stage based on `awaiting`:
    //   'cover_verify'               → coloring-cover-verify (split half 2)
    //   'cover_pdf_publish'          → coloring-cover-generate (split half 1) → assemble → publish
    //   'publish'                    → coloring-book-publish
    //   otherwise                    → coloring-book-render (interior)
    //
    // Cover split v1 (2026-07-18, OOM class fix cover-function-worker-oom-v1):
    // generate and verify run in separate isolates so a crash in either half
    // is isolated, stamped, and resumable.
    const dispatchPromises = queued.map(async (row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const awaiting = meta.awaiting as string | undefined;
      let target = "coloring-book-render";
      if (awaiting === "cover_verify") {
        target = "coloring-cover-verify";
      } else if (awaiting === "cover_pdf_publish") {
        target = row.cover_url ? (row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble") : "coloring-cover-generate";
      } else if (awaiting === "publish" || awaiting === "publish_candidate" || awaiting === "owner_final_verification") {
        target = row.pdf_url ? "coloring-book-publish" : "coloring-book-assemble";
      }
      const outcome = await fireAndForgetPost(
        `${url}/functions/v1/${target}`,
        { Authorization: `Bearer ${service}`, apikey: service },
        { ebook_id: row.id, ...(awaiting === "publish_candidate" || awaiting === "owner_final_verification" ? { mode: "candidate" } : {}) },
        3_000,
      );
      // Stamp cooldown so the next tick doesn't re-pick the same row before
      // the target stage has had time to complete (or park itself).
      try {
        await db.from("ebooks_kids").update({
          metadata: { ...meta, coloring_last_dispatched_at: new Date().toISOString(), coloring_last_dispatched_target: target },
        }).eq("id", row.id);
      } catch (_e) { /* best-effort */ }
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
