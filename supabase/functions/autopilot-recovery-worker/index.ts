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

  return new Response(JSON.stringify({
    ok: true,
    dry_run: dry,
    shopify_quota_remaining_today: remaining,
    shopify_uploads_resumed: resumed,
    shopify_still_waiting: stillWaiting,
    orphan_ebooks_enqueued: (orphans ?? []).length,
    stalled_runs_resumed: stalledResumed,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
