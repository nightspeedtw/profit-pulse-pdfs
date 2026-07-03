// Autopilot Recovery Worker
//
// Polls for jobs that are waiting for a quota window, a temporary API error
// to clear, or a stalled heartbeat, and resumes them automatically.
//
// Designed to run every ~5 minutes (pg_cron → net.http_post) but is also
// safe to invoke on-demand from the admin dashboard.
//
// POST body (all optional):
//   { dry_run?: boolean }
//
// Response: summary of how many jobs were resumed / requeued.

import { admin, corsHeaders } from "../_shared/ai.ts";
import { nextUtcMidnight, LOCK_HEAVY, getLockHolder } from "../_shared/recovery.ts";
import { classifyError } from "../_shared/error-classifier.ts";
import {
  firstBlockingGate,
  markGateNeedsCodeFix,
  persistQcSnapshot,
  MAX_AUTOFIX_ATTEMPTS,
} from "../_shared/autopilot-self-heal.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function invokePipeline(ebook_id: string) {
  return fetch(`${SUPABASE_URL}/functions/v1/autopilot-pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ ebook_id, mode: "full" }),
  });
}

async function invokeAutofix(ebook_id: string, gate: string) {
  return fetch(`${SUPABASE_URL}/functions/v1/autofix-action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ ebook_id, action: "autofix_gate", gate }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = admin();
  const body = await req.json().catch(() => ({} as { dry_run?: boolean }));
  const dry = !!body.dry_run;

  const { data: settings } = await db.from("generation_settings").select("*").eq("id", 1).maybeSingle();
  const maxPerDay = Number(settings?.max_shopify_uploads_per_day ?? 20);

  // How many Shopify uploads have completed today (UTC)?
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count: uploadedToday = 0 } = await db
    .from("ebooks")
    .select("id", { count: "exact", head: true })
    .not("shopify_product_id", "is", null)
    .gte("shopify_synced_at", startOfDay.toISOString());
  const remaining = Math.max(0, maxPerDay - (uploadedToday ?? 0));

  const now = new Date().toISOString();
  const resumed: string[] = [];
  const stillWaiting: string[] = [];
  const reclassifiedRecoverable: string[] = [];
  const qcAutofixQueued: Array<{ ebook_id: string; gate: string; attempt: number }> = [];
  const qcEscalatedToCodeFix: Array<{ ebook_id: string; gate: string }> = [];

  // 1) Shopify quota queue — resume when we have quota AND next_retry_at passed
  const { data: queued } = await db
    .from("shopify_upload_queue")
    .select("id, ebook_id, status, next_retry_at, attempt_count, max_attempts")
    .in("status", ["queued", "waiting_for_quota"])
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(50);

  for (const q of queued ?? []) {
    const ready = !q.next_retry_at || q.next_retry_at <= now;
    if (!ready) { stillWaiting.push(q.ebook_id); continue; }
    if (remaining - resumed.length <= 0) { stillWaiting.push(q.ebook_id); continue; }
    if ((q.attempt_count ?? 0) >= (q.max_attempts ?? 10)) {
      if (!dry) await db.from("shopify_upload_queue").update({
        status: "failed_needs_admin",
        last_error: "max_attempts exceeded",
      }).eq("id", q.id);
      continue;
    }
    resumed.push(q.ebook_id);
    if (dry) continue;
    await db.from("shopify_upload_queue").update({
      status: "uploading",
      attempt_count: (q.attempt_count ?? 0) + 1,
      last_error: null,
    }).eq("id", q.id);
    await db.from("ebooks").update({
      autopilot_state: "running",
      blocker_reason: null,
      blocker_class: null,
      next_retry_at: null,
    }).eq("id", q.ebook_id);
    // fire-and-forget; pipeline handles its own errors and re-enqueues on cap
    invokePipeline(q.ebook_id).catch((e) =>
      console.warn("[recovery] pipeline invoke failed", q.ebook_id, e?.message ?? e)
    );
  }

  // 2) Ebooks marked waiting_for_shopify_quota but never enqueued
  const { data: orphans } = await db
    .from("ebooks")
    .select("id")
    .eq("autopilot_state", "waiting_for_shopify_quota")
    .not("id", "in", `(${(queued ?? []).map((q) => `"${q.ebook_id}"`).join(",") || "''"})`)
    .limit(50);
  for (const o of orphans ?? []) {
    if (!dry) await db.from("shopify_upload_queue").upsert({
      ebook_id: o.id,
      status: "waiting_for_quota",
      blocker_reason: "daily_shopify_upload_cap_reached",
      next_retry_at: nextUtcMidnight(),
    }, { onConflict: "ebook_id" });
  }

  // 3) Stalled heartbeats — runs stuck in "running" with no update in 15 min
  const stallCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: stalled } = await db
    .from("autopilot_pipeline_runs")
    .select("id, ebook_id, updated_at, status")
    .eq("status", "running")
    .lt("updated_at", stallCutoff)
    .limit(20);
  const stalledResumed: string[] = [];
  for (const r of stalled ?? []) {
    if (!r.ebook_id) continue;
    stalledResumed.push(r.ebook_id);
    if (dry) continue;
    await db.from("autopilot_pipeline_runs").update({
      status: "queued",
      blocker_class: "recoverable_temporary_api_error",
      blocker_reason: "stalled_heartbeat_resumed",
    }).eq("id", r.id);
    invokePipeline(r.ebook_id).catch((e) =>
      console.warn("[recovery] stalled resume failed", r.ebook_id, e?.message ?? e)
    );
  }

  // 3b) Historical red failures from recoverable QC/provider errors. Older
  //     deployments used to mark truncated JSON / Edge idle timeout as failed.
  //     Reclassify them into wait/queue states so they heal without a click.
  const { data: failedRecoverables } = await db
    .from("autopilot_pipeline_runs")
    .select("id, ebook_id, error_message")
    .eq("status", "failed")
    .or("error_message.ilike.%Truncated JSON%,error_message.ilike.%IDLE_TIMEOUT%,error_message.ilike.%idle timeout%,error_message.ilike.%timeout limit%,error_message.ilike.%No JSON found%,error_message.ilike.%invalid JSON%")
    .order("failed_at", { ascending: false, nullsFirst: false })
    .limit(25);

  for (const r of failedRecoverables ?? []) {
    if (!r.ebook_id) continue;
    const classified = classifyError(new Error(r.error_message ?? "recoverable QC provider error"), {
      step: String(r.error_message ?? "").includes("reader-experience-qc") ? "reader_experience_qc" : "final_manuscript_qc",
      ebook_id: r.ebook_id,
      run_id: r.id,
    });
    if (!classified.recoverable || classified.needs_code_fix) continue;
    const retryAt = classified.next_retry_at ?? new Date(Date.now() + 2 * 60_000).toISOString();
    const nextState = String(classified.suggested_status).startsWith("waiting_")
      ? classified.suggested_status
      : "queued_for_production";
    reclassifiedRecoverable.push(r.ebook_id);
    if (dry) continue;
    await db.from("ebooks").update({
      autopilot_state: nextState,
      canonical_status: nextState,
      blocker_class: classified.error_type,
      blocker_reason: classified.fingerprint,
      needs_review_reason: null,
      next_retry_at: retryAt,
      manuscript_qc_status: String(r.error_message ?? "").includes("final-manuscript-qc") ? "auto_retry" : undefined,
      reader_experience_status: String(r.error_message ?? "").includes("reader-experience-qc") ? "auto_retry" : undefined,
    }).eq("id", r.ebook_id);
    await db.from("autopilot_pipeline_runs").update({
      status: "waiting",
      error_message: null,
      current_action_message: classified.user_friendly_message,
      updated_at: new Date().toISOString(),
    }).eq("id", r.id);
  }

  // 4) Waiting for Browserless slot — resume when next_retry_at has passed.
  //    These ebooks still hold the heavy_production lock (per Sequential Safe
  //    Mode spec) so re-invoking the pipeline for them is safe and will only
  //    kick off one PDF render at a time.
  const { data: browserlessWaiters } = await db
    .from("ebooks")
    .select("id, next_retry_at")
    .eq("autopilot_state", "waiting_for_browserless_slot")
    .lte("next_retry_at", now)
    .limit(5);
  const browserlessResumed: string[] = [];
  for (const b of browserlessWaiters ?? []) {
    browserlessResumed.push(b.id);
    if (dry) continue;
    invokePipeline(b.id).catch((e) =>
      console.warn("[recovery] browserless-wait resume failed", b.id, e?.message ?? e)
    );
  }

  // 4b) Time-sliced AI/QC work — resume after the function intentionally
  //     stops before the 150s idle timeout. This is a healthy wait state, not
  //     a failure. Sequential Safe Mode will reacquire the heavy lock before
  //     continuing.
  const { data: workerWaiters } = await db
    .from("ebooks")
    .select("id, next_retry_at")
    .in("autopilot_state", ["waiting_for_worker_slot", "waiting_for_ai_budget"])
    // Include rows with NULL next_retry_at — otherwise they get stuck forever.
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .limit(5);
  const workerResumed: string[] = [];
  for (const w of workerWaiters ?? []) {
    workerResumed.push(w.id);
    if (dry) continue;
    await db.from("ebooks").update({
      autopilot_state: "queued_for_production",
      canonical_status: "queued_for_production",
      blocker_reason: null,
      blocker_class: null,
      next_retry_at: null,
    }).eq("id", w.id);
    invokePipeline(w.id).catch((e) =>
      console.warn("[recovery] worker-wait resume failed", w.id, e?.message ?? e)
    );
  }

  // 4d) needs_admin_attention / needs_admin / needs_action — auto-retry once
  //     with fresh attempt counters. If the book still fails downstream, the
  //     pipeline will land it back in needs_review with a clean error, but the
  //     user's expectation is "system should keep trying automatically."
  const { data: adminNeeded } = await db
    .from("ebooks")
    .select("id, updated_at, auto_fix_attempt_count")
    .in("autopilot_state", ["needs_admin_attention", "needs_admin", "needs_action"])
    .is("shopify_product_id", null)
    .lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(10);
  const adminNeededResumed: string[] = [];
  for (const a of adminNeeded ?? []) {
    adminNeededResumed.push(a.id);
    if (dry) continue;
    await db.from("ebooks").update({
      autopilot_state: "queued_for_production",
      canonical_status: "queued_for_production",
      auto_fix_attempt_count: 0,
      autofix_attempt: 0,
      blocker_class: null,
      blocker_reason: null,
      needs_review_reason: null,
      waiting_reason: "Auto-resumed by recovery worker after admin_attention timeout.",
      next_retry_at: null,
    }).eq("id", a.id);
  }

  // 4c) Backend-driven QC auto-fix — do NOT rely on the dashboard being open.
  //     If any premium gate is blocked, trigger the same targeted autofix that
  //     the UI button used to trigger. After 3 attempts, create a Lovable prompt
  //     and move the ebook to needs_code_fix instead of silently stalling.
  const qcCols = [
    "id,title,autopilot_state,canonical_status,next_retry_at,shopify_product_id,pdf_url,cover_url",
    "auto_fix_attempt_count,autofix_attempt,qc_ready_for_shopify,qc_gates_json",
    "pdf_qc,cover_qc,reader_experience_qc,pdf_score,cover_score,reader_experience_score,reader_experience_status,reader_experience_fix_count",
  ].join(",");
  const { data: qcCandidates } = await db
    .from("ebooks")
    .select(qcCols)
    .is("shopify_product_id", null)
    .or([
      "autopilot_state.in.(needs_review,failed_non_recoverable,auto_fixing,needs_code_fix,ready_to_publish,completed)",
      "canonical_status.in.(needs_review,failed_non_recoverable,auto_fixing,needs_code_fix,ready_to_publish,completed)",
      "qc_ready_for_shopify.eq.false",
    ].join(","))
    .order("updated_at", { ascending: false })
    .limit(40);

  for (const raw of qcCandidates ?? []) {
    const ebook = raw as unknown as Record<string, any>;
    if (qcAutofixQueued.length >= 3 && !dry) break;
    if (ebook.next_retry_at && ebook.next_retry_at > now) continue;
    const hasStartedAssets = !!(ebook.pdf_url || ebook.cover_url || ebook.reader_experience_status);
    if (!hasStartedAssets) continue;
    const report = await persistQcSnapshot(db, ebook as Record<string, unknown>);
    if (report.ready_for_shopify && ebook.pdf_url) {
      const shopifyDraftEnabled = settings?.shopify_draft_upload_enabled !== false;
      if (!dry) await db.from("ebooks").update({
        autopilot_state: "ready_to_publish",
        canonical_status: "ready_to_publish",
        qc_status: "qc_passed",
        blocker_reason: null,
        blocker_class: null,
        waiting_reason: shopifyDraftEnabled
          ? "QC passed — resuming pipeline to upload Shopify draft automatically."
          : null,
        needs_review_reason: null,
        next_recommended_action: shopifyDraftEnabled ? "shopify_draft_upload" : null,
      }).eq("id", ebook.id);
      if (shopifyDraftEnabled && !dry) {
        resumed.push(ebook.id);
        invokePipeline(ebook.id).catch((e) =>
          console.warn("[recovery] ready-to-shopify resume failed", ebook.id, e?.message ?? e)
        );
      }
      continue;
    }
    const gate = firstBlockingGate(report);
    if (!gate) continue;
    const retryingAfterCodeFix = ebook.autopilot_state === "needs_code_fix" || ebook.canonical_status === "needs_code_fix";
    const attempts = retryingAfterCodeFix ? 0 : Number(ebook.auto_fix_attempt_count ?? ebook.autofix_attempt ?? 0);
    if (attempts >= MAX_AUTOFIX_ATTEMPTS) {
      qcEscalatedToCodeFix.push({ ebook_id: ebook.id, gate });
      if (!dry) await markGateNeedsCodeFix(db, ebook as Record<string, unknown>, gate, report, attempts);
      continue;
    }
    qcAutofixQueued.push({ ebook_id: ebook.id, gate, attempt: attempts + 1 });
    if (dry) continue;
    await db.from("ebooks").update({
      autopilot_state: "auto_fixing",
      canonical_status: "auto_fixing",
      waiting_reason: `Auto-fixing ${gate} automatically — attempt ${attempts + 1}/${MAX_AUTOFIX_ATTEMPTS}`,
      blocker_class: "qc_repairable",
      blocker_reason: `autofix_${gate}`,
      next_recommended_action: `autofix:${gate}`,
      current_step: gate,
      current_step_label: `Auto-fix ${gate}`,
      current_action_message: `Auto-fixing failed QC gate: ${gate}`,
      current_subtask: `Backend recovery worker triggered targeted repair ${attempts + 1}/${MAX_AUTOFIX_ATTEMPTS}`,
      structured_error: {
        error_type: "qc_repairable",
        gate,
        auto_recovery_action: `autofix:${gate}`,
        attempt: attempts + 1,
        max_attempts: MAX_AUTOFIX_ATTEMPTS,
      },
      ...(retryingAfterCodeFix ? { auto_fix_attempt_count: 0, autofix_attempt: 0 } : {}),
      last_heartbeat_at: now,
    }).eq("id", ebook.id);
    const r = await invokeAutofix(ebook.id, gate).catch((e) => ({ ok: false, status: 500, error: e } as Response & { error?: unknown }));
    if (!(r as Response).ok) {
      console.warn("[recovery] autofix invoke failed", ebook.id, gate, (r as Response).status);
    }
  }

  // 5) queued_for_production — dispatch ONE at a time when heavy_production
  //    lock is free (Sequential Safe Mode: heavy_production_concurrency = 1).
  let heavyHolder = await getLockHolder(db, LOCK_HEAVY);
  let heavyFree = !heavyHolder.holder ||
    (heavyHolder.expires_at ? heavyHolder.expires_at < now : true);

  // 5a) Stale-lock auto-release — if the holder ebook has no fresh heartbeat
  //     in the last 10 minutes, force-release the lock so the queue can move.
  //     This prevents "system doing nothing" when a run silently dies.
  if (!heavyFree && heavyHolder.holder) {
    const { data: holderEbook } = await db
      .from("ebooks")
      .select("id,last_heartbeat_at,autopilot_state")
      .eq("id", heavyHolder.holder)
      .maybeSingle();
    const hbAge = holderEbook?.last_heartbeat_at
      ? Date.now() - new Date(holderEbook.last_heartbeat_at).getTime()
      : Infinity;
    const state = holderEbook?.autopilot_state ?? "";
    const isActiveWait = ["waiting_for_browserless_slot", "waiting_for_worker_slot", "waiting_for_ai_budget"].includes(state);
    if (hbAge > 10 * 60 * 1000 && !isActiveWait) {
      console.warn("[recovery] force-releasing stale heavy_production lock", heavyHolder.holder, "hb_age_ms=", hbAge);
      if (!dry) {
        await db.from("production_locks").delete().eq("name", LOCK_HEAVY);
      }
      heavyHolder = { holder: null, expires_at: null };
      heavyFree = true;
    }
  }

  const queuedDispatched: string[] = [];
  if (heavyFree) {
    const { data: nextQueued } = await db
      .from("ebooks")
      .select("id, created_at")
      .eq("autopilot_state", "queued_for_production")
      .order("created_at", { ascending: true })
      .limit(1);
    for (const q of nextQueued ?? []) {
      queuedDispatched.push(q.id);
      if (dry) continue;
      invokePipeline(q.id).catch((e) =>
        console.warn("[recovery] queued dispatch failed", q.id, e?.message ?? e)
      );
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    dry_run: dry,
    shopify_quota_remaining_today: remaining,
    shopify_uploads_resumed: resumed,
    shopify_still_waiting: stillWaiting,
    orphan_ebooks_enqueued: (orphans ?? []).length,
    stalled_runs_resumed: stalledResumed,
    reclassified_recoverable_failures: reclassifiedRecoverable,
    browserless_waiters_resumed: browserlessResumed,
    worker_waiters_resumed: workerResumed,
    qc_autofix_queued: qcAutofixQueued,
    qc_escalated_to_code_fix: qcEscalatedToCodeFix,
    heavy_production_lock: {
      holder: heavyHolder.holder,
      expires_at: heavyHolder.expires_at,
      free: heavyFree,
    },
    queued_for_production_dispatched: queuedDispatched,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
