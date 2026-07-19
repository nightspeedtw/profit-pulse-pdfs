// health-monitor — SQL-only pipeline health checks + Resend email alerts.
// Modes:
//   default (?mode=check):  run all critical/info checks, emit alerts, send emails
//   ?mode=digest         :  build 24h summary and email once
//   ?mode=status         :  read-only, return active critical conditions (for admin banner)
//
// Every 15 min for check, once daily for digest. See cron setup in DB.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY");

const OWNER_EMAIL = "pisanu@igniteroi.com";
const FROM_EMAIL  = "SecretPDF Alerts <onboarding@resend.dev>"; // owner-only recipient
const ADMIN_URL   = "https://www.secretpdf.co/admin";

const CRITICAL_COOLDOWN_HOURS = 6;
const DEFAULT_DAILY_SPEND_CEILING_USD = 10;
const DEAD_THRESHOLD_MS = 60_000; // owner: alert if system quiet >60s

const CRITICAL_CLASSES = new Set([
  "worker_dead", "provider_blocked", "spend_ceiling",
  "queue_frozen", "unbounded_retry", "system_dead",
]);

type Alert = {
  alert_class: string;
  severity: "critical" | "info";
  title: string;
  body: string;
  evidence?: Record<string, unknown>;
};

// Module-scope singleton: reused across warm invocations on the same isolate.
// Each isolate uses PostgREST over HTTPS, not a direct pgbouncer session, so
// this does NOT consume a pooler slot — but reusing the client still avoids
// re-parsing config on every request.
const _sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
function db() { return _sb; }

// DB-independent alert email — used when the monitor itself can't reach the DB.
// Blind-spot fix: a DB-dependent monitor can't report a dead DB via alert_log,
// so we email via Resend directly on the monitor's error path. No cooldown:
// the cron runs every 15 min, so worst case is 4 emails/hr during a real outage,
// which is a feature, not spam.
async function emailMonitorOutage(err: unknown): Promise<void> {
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) return;
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
    <h2 style="color:#b91c1c">🔴 health-monitor could not reach the database</h2>
    <p>The monitor's own DB reads failed. This almost always means the Lovable Cloud DB / pooler is unreachable, so the queue, workers, and admin panels are also down.</p>
    <pre style="background:#f1f5f9;padding:12px;border-radius:6px;white-space:pre-wrap">${msg.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>
    <p style="font-size:12px;color:#64748b">Sent directly via Resend (bypassing DB). Admin: ${ADMIN_URL} · ${new Date().toISOString()}</p>
  </div>`;
  try {
    await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [OWNER_EMAIL],
        subject: `[SecretPDF CRITICAL] Monitor cannot reach database`,
        html,
      }),
    });
  } catch (_) { /* nothing else we can do */ }
}

// deno-lint-ignore no-explicit-any
async function q(sb: any, sql: string, params?: any[]): Promise<any[]> {
  // Direct query via the .rpc pattern isn't available for raw SQL; use the
  // typed client for known tables and PostgREST for the rest.
  throw new Error(`unused: ${sql}`);
}

// ----- checks --------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function runChecks(sb: any): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = Date.now();

  // (a) worker heartbeat stale >15 min while queue non-empty.
  // SOURCE OF TRUTH: generation_settings.coloring_autopilot.last_worker_tick_at
  // — this is what coloring-worker-tick actually writes every cron cycle.
  // (Do NOT read ebooks_kids.last_heartbeat_at — that field is not maintained
  //  by the current worker; reader must match the writer.)
  const { data: gsHb } = await sb
    .from("generation_settings")
    .select("coloring_autopilot")
    .eq("id", 1).maybeSingle();
  const tickIso = (gsHb?.coloring_autopilot as any)?.last_worker_tick_at ?? null;
  const { count: queuedCount } = await sb
    .from("ebooks_kids")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_status", "queued");

  const latestHb = tickIso ? new Date(tickIso).getTime() : null;
  const hbAgeMin = latestHb ? Math.round((now - latestHb) / 60000) : null;
  // Grace period: if we've never seen a tick, don't fire on the first cycle —
  // the worker may not have run since deploy. Only alert when a tick exists
  // and is >15 min old with queued books waiting.
  if ((queuedCount ?? 0) > 0 && latestHb !== null && hbAgeMin! > 15) {
    alerts.push({
      alert_class: "worker_dead",
      severity: "critical",
      title: `Worker heartbeat stale (${hbAgeMin} min old) with ${queuedCount} queued`,
      body: `Last worker tick was ${hbAgeMin} min ago (${tickIso}), but ${queuedCount} books are queued.\nLikely dispatcher / cron / edge-function stall.\nAdmin: ${ADMIN_URL}`,
      evidence: { queued: queuedCount, heartbeat_age_min: hbAgeMin, latest_tick_at: tickIso, source: "generation_settings.coloring_autopilot.last_worker_tick_at" },
    });
  } else if ((queuedCount ?? 0) > 0 && latestHb === null) {
    // Info-only: no tick ever recorded. Do NOT emit critical alert — grace
    // period until the first tick is observed.
    console.warn("health-monitor: no last_worker_tick_at recorded yet; skipping worker_dead alert (grace period)");
  }

  // (b) books stuck in active status with no updated_at movement >30 min,
  //     not already parked with a blocker.
  const cutoff = new Date(now - 30 * 60 * 1000).toISOString();
  const { data: stuck } = await sb
    .from("ebooks_kids")
    .select("id,title,pipeline_status,updated_at,blocker_reason")
    .in("pipeline_status", ["generating","awaiting_cover","pdf_building","publishing","running"])
    .is("blocker_reason", null)
    .lt("updated_at", cutoff)
    .limit(20);
  if ((stuck?.length ?? 0) > 0) {
    alerts.push({
      alert_class: "book_stuck",
      severity: "critical",
      title: `${stuck!.length} book(s) stuck in active status >30 min — auto-requeue in progress`,
      body:
        stuck!.map((b: any) => `• ${b.title ?? b.id} — ${b.pipeline_status} (updated ${b.updated_at})`).join("\n") +
        `\n\nAuto-heal: stall-watchdog will requeue these next tick (per-book ceiling 3; escalates to human_review after that). No action needed unless this alert persists >1h.` +
        `\nAdmin: ${ADMIN_URL}`,
      evidence: { stuck_ids: stuck!.map((b: any) => b.id), self_heal: "stall_watchdog_auto_requeue" },
    });
  }


  // (c) provider billing-block flags newly active.
  const { data: gsRow } = await sb
    .from("generation_settings")
    .select("coloring_autopilot")
    .eq("id", 1).maybeSingle();
  const cfg = (gsRow?.coloring_autopilot ?? {}) as any;
  const pbb = (cfg.provider_billing_blocked ?? {}) as Record<string, any>;
  const blockedProviders = Object.entries(pbb)
    .filter(([name, v]) => v?.active && name !== "fal")
    .map(([name, v]) => ({ provider: name, since: v?.since ?? null, reason: v?.reason ?? null }));
  if (blockedProviders.length > 0) {
    alerts.push({
      alert_class: "provider_blocked",
      severity: "critical",
      title: `Provider billing block active: ${blockedProviders.map(p => p.provider).join(", ")}`,
      body: blockedProviders.map(p => `• ${p.provider} — since ${p.since ?? "?"} — ${p.reason ?? "n/a"}`).join("\n") +
            `\n\nCheck the provider dashboard for balance / quota. Admin: ${ADMIN_URL}`,
      evidence: { providers: blockedProviders },
    });
  }

  // (d) queue not draining: consult platform_settings for prior queue depth samples.
  const { data: qhistRow } = await sb
    .from("platform_settings")
    .select("value_json")
    .eq("key", "health_queue_history").maybeSingle();
  const history: Array<{ at: string; queued: number; dispatches: number }> =
    Array.isArray(qhistRow?.value_json?.samples) ? qhistRow.value_json.samples : [];
  // Count "dispatches" as ebooks_kids where pipeline_status changed to
  // generating/publishing/etc. in the last 15 min — proxy via updated_at.
  const since = new Date(now - 15 * 60 * 1000).toISOString();
  const { count: dispatchCount } = await sb
    .from("ebooks_kids")
    .select("id", { count: "exact", head: true })
    .gte("updated_at", since)
    .in("pipeline_status", ["generating","awaiting_cover","pdf_building","publishing"]);
  history.push({ at: new Date().toISOString(), queued: queuedCount ?? 0, dispatches: dispatchCount ?? 0 });
  const trimmed = history.slice(-5);
  await sb.from("platform_settings").upsert({
    key: "health_queue_history",
    value_json: { samples: trimmed },
    updated_at: new Date().toISOString(),
  });
  if (trimmed.length >= 3) {
    const last3 = trimmed.slice(-3);
    const sameQueue = last3.every(s => s.queued === last3[0].queued) && last3[0].queued > 0;
    const zeroDispatch = last3.every(s => s.dispatches === 0);
    if (sameQueue && zeroDispatch) {
      alerts.push({
        alert_class: "queue_frozen",
        severity: "critical",
        title: `Queue frozen: ${last3[0].queued} queued, 0 dispatches across 3 ticks`,
        body: `Queue depth unchanged at ${last3[0].queued} for the last ${last3.length * 15} min with zero dispatches.\nAdmin: ${ADMIN_URL}`,
        evidence: { samples: last3 },
      });
    }
  }

  // (e) daily spend & unbounded per-(book,step) retry.
  const ceilingRow = await sb.from("platform_settings").select("value_json").eq("key","health_spend_ceiling_usd").maybeSingle();
  const spendCeiling = Number(ceilingRow?.data?.value_json?.usd ?? DEFAULT_DAILY_SPEND_CEILING_USD);
  const startOfDay = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const { data: costs } = await sb
    .from("cost_log")
    .select("cost_usd, ebook_id, step, provider")
    .gte("created_at", startOfDay)
    .limit(10000);
  const totalSpend = (costs ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);
  if (totalSpend > spendCeiling) {
    alerts.push({
      alert_class: "spend_ceiling",
      severity: "critical",
      title: `Daily spend $${totalSpend.toFixed(2)} exceeds ceiling $${spendCeiling.toFixed(2)}`,
      body: `Runtime spend in the last 24h has crossed the configured ceiling.\nSet a new ceiling by writing platform_settings.health_spend_ceiling_usd = {"usd": <n>}.\nAdmin: ${ADMIN_URL}`,
      evidence: { spend_24h_usd: Number(totalSpend.toFixed(4)), ceiling_usd: spendCeiling },
    });
  }
  const perPair = new Map<string, number>();
  for (const r of (costs ?? []) as any[]) {
    if (!r.ebook_id || !r.step) continue;
    const k = `${r.ebook_id}|${r.step}`;
    perPair.set(k, (perPair.get(k) ?? 0) + 1);
  }
  const hotPairs = Array.from(perPair.entries()).filter(([_, n]) => n > 5).slice(0, 20);
  if (hotPairs.length > 0) {
    alerts.push({
      alert_class: "unbounded_retry",
      severity: "critical",
      title: `${hotPairs.length} (book, step) pair(s) exceeded 5 paid calls in 24h`,
      body: hotPairs.map(([k, n]) => `• ${k} — ${n} paid calls`).join("\n") + `\n\nAdmin: ${ADMIN_URL}`,
      evidence: { pairs: hotPairs.map(([k, n]) => ({ key: k, count: n })) },
    });
  }

  // (f) NEW stall_events / newly parked books since last check.
  const { data: lastCheckRow } = await sb.from("platform_settings").select("value_json").eq("key","health_last_check_at").maybeSingle();
  const lastCheckAt: string = lastCheckRow?.value_json?.at ?? new Date(now - 15 * 60 * 1000).toISOString();
  const { data: newStalls } = await sb.from("stall_events")
    .select("id, ebook_id, blocker_class, step_label, detected_at")
    .gte("detected_at", lastCheckAt)
    .limit(50);
  if ((newStalls?.length ?? 0) > 0) {
    alerts.push({
      alert_class: "stall_events",
      severity: "info",
      title: `${newStalls!.length} new stall event(s) since ${lastCheckAt}`,
      body: newStalls!.map((s: any) => `• ${s.blocker_class}: ${s.step_label} (${s.ebook_id})`).join("\n"),
      evidence: { events: newStalls },
    });
  }
  const { data: newParks } = await sb.from("ebooks_kids")
    .select("id, title, blocker_reason, updated_at")
    .gte("updated_at", lastCheckAt)
    .not("blocker_reason", "is", null)
    .not("pipeline_status", "in", "(retired,archived_legacy)")
    .limit(50);
  if ((newParks?.length ?? 0) > 0) {
    alerts.push({
      alert_class: "book_parked",
      severity: "info",
      title: `${newParks!.length} book(s) newly parked with a blocker`,
      body: newParks!.map((b: any) => `• ${b.title ?? b.id} — ${b.blocker_reason}`).join("\n"),
      evidence: { books: newParks },
    });
  }

  await sb.from("platform_settings").upsert({
    key: "health_last_check_at",
    value_json: { at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });

  return alerts;
}

// ----- persistence + email -------------------------------------------------

// deno-lint-ignore no-explicit-any
async function shouldSendEmail(sb: any, alertClass: string): Promise<boolean> {
  if (!CRITICAL_CLASSES.has(alertClass)) return false;
  const since = new Date(Date.now() - CRITICAL_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data } = await sb.from("alert_log")
    .select("id")
    .eq("alert_class", alertClass)
    .eq("email_sent", true)
    .gte("created_at", since)
    .limit(1);
  return (data?.length ?? 0) === 0;
}

async function sendEmail(subject: string, html: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) return { ok: false, error: "resend_not_configured" };
  try {
    const r = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [OWNER_EMAIL],
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, error: `[${r.status}] ${body.slice(0, 400)}` };
    }
    const j = await r.json();
    return { ok: true, id: j?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function renderAlertHtml(a: Alert): string {
  const bodyHtml = a.body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\n/g, "<br/>");
  return `<div style="font-family:system-ui,sans-serif;max-width:640px">
  <h2 style="color:${a.severity==='critical'?'#b91c1c':'#334155'};margin:0 0 12px">${a.severity==='critical'?'🔴':'🟡'} ${a.title}</h2>
  <div style="white-space:pre-wrap;line-height:1.5">${bodyHtml}</div>
  <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb"/>
  <p style="font-size:12px;color:#64748b">SecretPDF health-monitor · class=${a.alert_class} · ${new Date().toISOString()}</p>
</div>`;
}

// deno-lint-ignore no-explicit-any
async function persistAndMaybeEmail(sb: any, alerts: Alert[]) {
  for (const a of alerts) {
    const send = await shouldSendEmail(sb, a.alert_class);
    let emailResult: { ok: boolean; id?: string; error?: string } = { ok: false };
    if (send) {
      emailResult = await sendEmail(`[SecretPDF ${a.severity}] ${a.title}`, renderAlertHtml(a));
    }
    await sb.from("alert_log").insert({
      alert_class: a.alert_class,
      severity: a.severity,
      title: a.title,
      body: a.body,
      evidence: a.evidence ?? {},
      email_sent: emailResult.ok,
      email_message_id: emailResult.id ?? null,
      email_error: send ? (emailResult.ok ? null : emailResult.error) : (CRITICAL_CLASSES.has(a.alert_class) ? "cooldown_active" : "info_class_no_email"),
    });
  }
}

// ----- digest --------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function runDigest(sb: any) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ count: liveCount }, { count: parkedCount }, { count: queuedCount },
         { data: costs }, { data: recent }] = await Promise.all([
    sb.from("ebooks_kids").select("id", { count: "exact", head: true })
      .eq("listing_status","live").gte("updated_at", since),
    sb.from("ebooks_kids").select("id", { count: "exact", head: true })
      .not("blocker_reason","is",null).gte("updated_at", since),
    sb.from("ebooks_kids").select("id", { count: "exact", head: true })
      .eq("pipeline_status","queued"),
    sb.from("cost_log").select("cost_usd,provider").gte("created_at", since).limit(10000),
    sb.from("alert_log").select("alert_class,title,severity,created_at")
      .gte("created_at", since).order("created_at",{ ascending: false }).limit(50),
  ]);
  const totalSpend = (costs ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);
  const byProvider: Record<string, number> = {};
  for (const r of (costs ?? []) as any[]) byProvider[r.provider ?? "unknown"] = (byProvider[r.provider ?? "unknown"] ?? 0) + Number(r.cost_usd ?? 0);
  const providerLines = Object.entries(byProvider).map(([p, v]) => `  ${p}: $${v.toFixed(3)}`).join("\n");
  const alertLines = (recent ?? []).map((a: any) => `  [${a.severity}] ${a.alert_class} — ${a.title}`).join("\n") || "  (none)";
  const body = `SecretPDF daily digest — last 24h
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Books published:   ${liveCount ?? 0}
Books parked:      ${parkedCount ?? 0}
Currently queued:  ${queuedCount ?? 0}

Runtime spend:     $${totalSpend.toFixed(2)}
By provider:
${providerLines || "  (no paid calls)"}

Alerts in the last 24h:
${alertLines}

Admin: ${ADMIN_URL}
`;
  const html = `<pre style="font-family:ui-monospace,monospace;font-size:13px;line-height:1.55">${body.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`;
  const email = await sendEmail(`[SecretPDF] Daily digest — ${new Date().toISOString().slice(0,10)}`, html);
  await sb.from("alert_log").insert({
    alert_class: "daily_digest",
    severity: "info",
    title: "Daily digest",
    body,
    evidence: { live: liveCount, parked: parkedCount, queued: queuedCount, spend_usd: totalSpend, providers: byProvider },
    email_sent: email.ok,
    email_message_id: email.id ?? null,
    email_error: email.ok ? null : email.error,
  });
  return { ok: true, email_sent: email.ok, email_error: email.error };
}

// ----- HTTP entry ----------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = db();
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "check";

  try {
    if (mode === "status") {
      const since = new Date(Date.now() - CRITICAL_COOLDOWN_HOURS * 3600 * 1000).toISOString();
      const { data } = await sb.from("alert_log")
        .select("alert_class,title,body,severity,created_at")
        .eq("severity","critical")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      // dedupe by class, keep latest
      const seen = new Set<string>();
      const active = [] as any[];
      for (const r of (data ?? [])) {
        if (seen.has(r.alert_class)) continue;
        seen.add(r.alert_class);
        active.push(r);
      }
      const { data: lastCheck } = await sb.from("platform_settings").select("value_json").eq("key","health_last_check_at").maybeSingle();
      return new Response(JSON.stringify({
        ok: true,
        active_critical: active,
        last_checked_at: lastCheck?.value_json?.at ?? null,
        resend_configured: !!(LOVABLE_API_KEY && RESEND_API_KEY),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (mode === "digest") {
      const r = await runDigest(sb);
      return new Response(JSON.stringify(r), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // default: check
    const alerts = await runChecks(sb);
    await persistAndMaybeEmail(sb, alerts);
    return new Response(JSON.stringify({
      ok: true,
      alerts_count: alerts.length,
      critical_count: alerts.filter(a => a.severity === "critical").length,
      resend_configured: !!(LOVABLE_API_KEY && RESEND_API_KEY),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("health-monitor error", e);
    // Blind-spot fix: if the monitor itself failed (usually a DB outage),
    // send an email directly via Resend that does NOT depend on the DB.
    await emailMonitorOutage(e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), monitor_outage_email_attempted: true }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
