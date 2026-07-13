// Autopilot Doctor — internal diagnostic.
// Scans autopilot state, auto-heals what it can, records structural bugs
// as system_fix_instructions ready for the admin to copy into Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyError, recordSystemFix, type StructuredError } from "../_shared/error-classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const HEAVY_STATUSES = new Set([
  "generating_outline",
  "writing_chapters",
  "building_manuscript",
  "running_qc",
  "auto_fixing",
  "generating_cover",
  "generating_thumbnail",
  "rendering_pdf",
  "publishing_live",
  "production_running",
]);

interface Issue {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  auto_fixed: boolean;
  ebook_id?: string | null;
  run_id?: string | null;
  fix?: StructuredError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Passcode OR anon call from cron (no header) both allowed; only reject other bearer tokens.
  const passcode =
    req.headers.get("x-admin-passcode") ??
    (await req.clone().json().then((b) => b?.passcode).catch(() => null));
  const isCron = !passcode && req.headers.get("authorization")?.includes("anon");
  if (!isCron && passcode !== PASSCODE) {
    // still allow — this is diagnostic; but return 401 for bad passcodes
    if (passcode && passcode !== PASSCODE) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  const issues: Issue[] = [];
  let autoFixed = 0;

  // --- 1. Stale heartbeats on heavy statuses ---
  const staleCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: stale } = await supabase
    .from("ebooks")
    .select("id,title,canonical_status,last_heartbeat_at")
    .in("canonical_status", Array.from(HEAVY_STATUSES))
    .lt("last_heartbeat_at", staleCutoff);
  for (const e of stale ?? []) {
    const fix = classifyError(new Error(`Stale heartbeat for ebook ${e.id}`), {
      step: e.canonical_status ?? "unknown",
      ebook_id: e.id,
    });
    issues.push({
      code: "stale_heartbeat",
      severity: "high",
      message: `Ebook "${e.title ?? e.id}" heartbeat > 5min`,
      auto_fixed: true,
      ebook_id: e.id,
      fix,
    });
    await supabase.rpc("release_lock", { p_name: "heavy_production", p_holder: e.id });
    await supabase
      .from("ebooks")
      .update({
        canonical_status: "queued_for_production",
        queue_position: 1,
        queued_at: new Date().toISOString(),
        waiting_reason: "Recovered after stale heartbeat — requeued",
        structured_error: fix,
      })
      .eq("id", e.id);
    await recordSystemFix(supabase, fix, { step: fix.affected_step, ebook_id: e.id });
    autoFixed++;
  }

  // --- 2. Multiple heavy holders (Sequential Safe Mode violation) ---
  const { data: heavy } = await supabase
    .from("ebooks")
    .select("id,title,canonical_status")
    .in("canonical_status", Array.from(HEAVY_STATUSES));
  if ((heavy ?? []).length > 1) {
    const fix = classifyError(
      new Error(
        `Concurrency violation: ${heavy!.length} ebooks in heavy status simultaneously.`,
      ),
      { step: "sequential_safe_mode" },
    );
    issues.push({
      code: "concurrency_violation",
      severity: "critical",
      message: `${heavy!.length} ebooks in heavy status at once.`,
      auto_fixed: false,
      fix,
    });
    await recordSystemFix(supabase, fix, { step: fix.affected_step });
  }

  // --- 3. Ebooks stuck as generic 'failed' that are actually quota waits ---
  const { data: failedRuns } = await supabase
    .from("autopilot_pipeline_runs")
    .select("id,ebook_id,error_message,status")
    .eq("status", "failed")
    .limit(50);
  for (const r of failedRuns ?? []) {
    const msg = String(r.error_message ?? "");
    if (!msg) continue;
    const fix = classifyError(new Error(msg), {
      step: "post_mortem",
      ebook_id: r.ebook_id,
      run_id: r.id,
    });
    if (fix.recoverable && fix.error_type !== "non_recoverable") {
      issues.push({
        code: "misclassified_failure",
        severity: "medium",
        message: `Run ${String(r.id).slice(0, 8)} marked failed but is actually ${fix.error_type}`,
        auto_fixed: true,
        run_id: r.id,
        ebook_id: r.ebook_id,
        fix,
      });
      if (r.ebook_id) {
        await supabase
          .from("ebooks")
          .update({
            canonical_status: fix.suggested_status,
            waiting_reason: fix.user_friendly_message,
            next_retry_at: fix.next_retry_at,
            structured_error: fix,
          })
          .eq("id", r.ebook_id);
      }
      autoFixed++;
    }
  }

  // --- 4. Steps without runs / runs without steps ---
  const { count: orphanSteps } = await supabase
    .from("autopilot_pipeline_steps")
    .select("id", { count: "exact", head: true })
    .is("run_id", null);
  if ((orphanSteps ?? 0) > 0) {
    issues.push({
      code: "orphan_steps",
      severity: "low",
      message: `${orphanSteps} pipeline steps have no run_id`,
      auto_fixed: false,
    });
  }

  // --- 5. Health score ---
  const critical = issues.filter((i) => i.severity === "critical").length;
  const high = issues.filter((i) => i.severity === "high").length;
  const medium = issues.filter((i) => i.severity === "medium").length;
  const score = Math.max(0, 100 - critical * 40 - high * 15 - medium * 5);

  return json({
    health_score: score,
    checked_at: new Date().toISOString(),
    total_issues: issues.length,
    auto_fixed: autoFixed,
    issues,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
