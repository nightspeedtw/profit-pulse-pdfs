// nightly-self-audit — proactive immune system.
//
// Runs every accumulated detection heuristic from known-regressions /
// pipeline_skills as pure SQL/config reads (zero AI, cheap). Emits rows
// to `self_audit_findings`. Critical findings are surfaced to the health
// monitor (via alert_log) so the existing Resend + banner path handles
// user delivery — no duplicate email code here.
//
// Detection classes covered (owner spec):
//   PC  persistence_contract     — every gate reader has a writer
//   CE  ceiling_without_consequence — attempt counters need dispatcher enforcement
//   PM  provider_monoculture     — single-provider hardcoded calls in book paths
//   SN  state_nobody_owns        — pipeline_status values with no dispatcher owner
//   PL  plan_loss                — assets present, plan missing
//   RL  resource_limit           — books w/ oversized payload risk (proxy: big metadata blobs)
//   UR  unbounded_retry          — per (book,step) paid call floods (24h)
//
// Grep-based classes (provider_monoculture, BigInt, full-res decode,
// unbounded per-page retry) are enforced at deploy-time via the vitest
// invariant suite; this runner catches the runtime footprint.
//
// Mode: default runs all checks. ?mode=status returns latest run summary.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const _sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// pipeline_status values that MUST be owned by some dispatcher/watchdog.
// Terminal + explicit-park states are excluded (they legitimately sit).
const OWNED_STATES = new Set([
  "queued","generating","awaiting_cover","awaiting_render",
  "pdf_building","publishing","qc_pending","final_qc","chapter_qc",
  "awaiting_quota_reset","running","ideation","outline_generation","writing",
]);
const TERMINAL_STATES = new Set([
  "published","live","retired","cancelled","rejected","parked_rotated",
  "human_review_required","failed","passed","ready_to_publish","shelved",
]);

type Finding = {
  check_key: string;
  severity: "critical" | "warning" | "info";
  defect_class: string;
  title: string;
  detail?: string;
  evidence?: Record<string, unknown>;
  affected_count?: number;
};

async function checkPersistenceContract(): Promise<Finding[]> {
  // Reader/writer field agreement for gate inputs. Concrete instance:
  // health-monitor reads generation_settings.coloring_autopilot.last_worker_tick_at;
  // it MUST be written by coloring-worker-tick. Detect via freshness — if
  // the queue moved but the field never updates, the writer is gone.
  const findings: Finding[] = [];
  const { data: gs } = await _sb.from("generation_settings")
    .select("coloring_autopilot").eq("id", 1).maybeSingle();
  const tickIso = (gs?.coloring_autopilot as any)?.last_worker_tick_at ?? null;
  const { count: queued } = await _sb.from("ebooks_kids")
    .select("id", { count: "exact", head: true }).eq("pipeline_status", "queued");
  if ((queued ?? 0) > 0 && !tickIso) {
    findings.push({
      check_key: "pc_worker_heartbeat_writer_missing",
      severity: "critical",
      defect_class: "persistence_contract",
      title: "Worker heartbeat field never written",
      detail: "generation_settings.coloring_autopilot.last_worker_tick_at is null but queue has work. Reader (health-monitor) has no writer.",
      evidence: { queued },
    });
  }
  return findings;
}

async function checkCeilingConsequence(): Promise<Finding[]> {
  // Any counter whose value exceeds its documented ceiling but the row is
  // still not parked/retired = ceiling without enforcement.
  const findings: Finding[] = [];
  const CAPS: Array<[string, number]> = [
    ["coloring_cover_invocations", 5],
    ["coloring_interior_invocations", 20],
    ["stall_auto_requeued_count", 3],
  ];
  const { data: rows } = await _sb.from("ebooks_kids")
    .select("id,title,pipeline_status,blocker_reason,metadata")
    .eq("book_type", "coloring_book")
    .not("pipeline_status", "in", `(${[...TERMINAL_STATES].map(s=>`"${s}"`).join(",")})`)
    .limit(500);
  const offenders: any[] = [];
  for (const r of (rows ?? []) as any[]) {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    for (const [key, cap] of CAPS) {
      const n = Number(m[key] ?? 0);
      if (n > cap && !r.blocker_reason) {
        offenders.push({ id: r.id, title: r.title, counter: key, value: n, cap });
      }
    }
  }
  if (offenders.length > 0) {
    findings.push({
      check_key: "ce_counter_over_cap_unparked",
      severity: "critical",
      defect_class: "ceiling_without_consequence",
      title: `${offenders.length} book(s) exceeded attempt ceiling with no blocker`,
      detail: "Counter is above cap but row is still active with blocker_reason=null. Dispatcher is not enforcing the ceiling.",
      evidence: { offenders: offenders.slice(0, 20) },
      affected_count: offenders.length,
    });
  }
  return findings;
}

async function checkStateOwners(): Promise<Finding[]> {
  // Enumerate distinct pipeline_status values currently in use for
  // coloring books. Any value NOT in OWNED_STATES ∪ TERMINAL_STATES is an
  // orphan state — no dispatcher/watchdog is coded to handle it.
  const findings: Finding[] = [];
  const { data: rows } = await _sb.from("ebooks_kids")
    .select("pipeline_status")
    .eq("book_type", "coloring_book")
    .limit(5000);
  const seen = new Map<string, number>();
  for (const r of (rows ?? []) as any[]) {
    const s = String(r.pipeline_status ?? "");
    seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  const orphans = [...seen.entries()].filter(([s]) =>
    s && !OWNED_STATES.has(s) && !TERMINAL_STATES.has(s));
  if (orphans.length > 0) {
    findings.push({
      check_key: "sn_orphan_pipeline_status",
      severity: "critical",
      defect_class: "state_nobody_owns",
      title: `Orphan pipeline_status values in use: ${orphans.map(([s])=>s).join(", ")}`,
      detail: "These states are not in OWNED_STATES (dispatcher-claimed) nor TERMINAL_STATES. Books can sit here forever.",
      evidence: { orphans: orphans.map(([s,n])=>({ state: s, count: n })) },
      affected_count: orphans.reduce((a,[,n])=>a+n, 0),
    });
  }
  return findings;
}

async function checkPlanLoss(): Promise<Finding[]> {
  // Books with rendered assets but no page plan — the c2839b88 class.
  const findings: Finding[] = [];
  const { data: rows } = await _sb.from("ebooks_kids")
    .select("id,title,pdf_url,cover_url,metadata,pipeline_status")
    .eq("book_type", "coloring_book")
    .not("cover_url", "is", null)
    .not("pipeline_status", "in", `(${[...TERMINAL_STATES].map(s=>`"${s}"`).join(",")})`)
    .limit(500);
  const offenders = (rows ?? []).filter((r: any) => {
    const m = (r.metadata ?? {}) as any;
    const plan = m.coloring_page_plan ?? m.page_plan ?? null;
    return !plan;
  });
  if (offenders.length > 0) {
    findings.push({
      check_key: "pl_assets_without_plan",
      severity: "warning",
      defect_class: "plan_loss",
      title: `${offenders.length} book(s) have assets but no page plan`,
      detail: "cover_url present but metadata.coloring_page_plan missing. Rehydrator may loop.",
      evidence: { ids: offenders.slice(0, 20).map((r: any) => r.id) },
      affected_count: offenders.length,
    });
  }
  return findings;
}

async function checkUnboundedRetry(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const since = new Date(Date.now() - 24*3600*1000).toISOString();
  const { data: costs } = await _sb.from("cost_log")
    .select("ebook_id, step").gte("created_at", since).limit(10000);
  const perPair = new Map<string, number>();
  for (const r of (costs ?? []) as any[]) {
    if (!r.ebook_id || !r.step) continue;
    const k = `${r.ebook_id}|${r.step}`;
    perPair.set(k, (perPair.get(k) ?? 0) + 1);
  }
  const hot = [...perPair.entries()].filter(([,n]) => n > 10);
  if (hot.length > 0) {
    findings.push({
      check_key: "ur_pair_over_10_calls_24h",
      severity: "critical",
      defect_class: "unbounded_retry",
      title: `${hot.length} (book, step) pair(s) fired >10 paid calls in 24h`,
      detail: "Retry ceiling missing or not enforced at dispatch site.",
      evidence: { top: hot.sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,n])=>({ pair: k, calls: n })) },
      affected_count: hot.length,
    });
  }
  return findings;
}

async function checkResourceLimit(): Promise<Finding[]> {
  // Proxy for BigInt/oversized-payload risk: metadata rows over 200KB
  // are close to edge-payload trouble.
  const findings: Finding[] = [];
  const { data: rows } = await _sb.rpc("exec_sql" as never, {}).then(
    () => ({ data: null }), () => ({ data: null }));
  // No exec_sql: approximate with a bounded scan on a representative slice.
  const { data: metas } = await _sb.from("ebooks_kids")
    .select("id,title,metadata").eq("book_type","coloring_book").limit(200);
  const big = (metas ?? []).filter((r: any) => {
    try { return JSON.stringify(r.metadata ?? {}).length > 200_000; }
    catch { return true; } // JSON error = BigInt or cycle
  });
  if (big.length > 0) {
    findings.push({
      check_key: "rl_oversized_metadata",
      severity: "warning",
      defect_class: "resource_limit",
      title: `${big.length} book(s) with metadata >200KB or non-serializable`,
      detail: "Risk of edge payload rejection / BigInt leak. Consider offloading to a side table.",
      evidence: { ids: big.slice(0, 10).map((r: any) => r.id) },
      affected_count: big.length,
    });
  }
  return findings;
}

// SG — story_gate_bypass: any book that has advanced past story_gate
// (illustrating / awaiting_cover / awaiting_render / pdf_building /
// publishing / live / published / final_qc / chapter_qc / qc_pending)
// while its stored qc_scorecard.story_gate.passed === false is a
// runtime bypass. The gate verdict written by the judge and the pipeline
// transition MUST share one source of truth (autopilot-kids-pipeline
// storyGate v5.1). This check catches drift/regression at the class level.
async function checkStoryGateBypass(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const POST_GATE = ['illustrating','awaiting_cover','awaiting_render','pdf_building','publishing','live','published','final_qc','chapter_qc','qc_pending','ready_to_publish'];
  const { data } = await _sb.from('ebooks_kids')
    .select('id,title,pipeline_status,qc_scorecard')
    .in('pipeline_status', POST_GATE)
    .limit(2000);
  const offenders: any[] = [];
  for (const r of (data ?? []) as any[]) {
    const sg = (r.qc_scorecard as any)?.story_gate;
    if (sg && sg.passed === false) {
      offenders.push({ id: r.id, title: r.title, status: r.pipeline_status, blockers: sg.blockers ?? [], scores: sg.scores ?? {} });
    }
  }
  if (offenders.length > 0) {
    findings.push({
      check_key: 'sg_post_gate_with_failed_verdict',
      severity: 'critical',
      defect_class: 'story_gate_bypass',
      title: `${offenders.length} book(s) past story_gate with stored passed=false`,
      detail: 'qc_scorecard.story_gate.passed is FALSE but pipeline_status advanced past the gate. The transition is not reading the same verdict the judge wrote. Single-source-of-truth invariant violated.',
      evidence: { offenders: offenders.slice(0, 20) },
      affected_count: offenders.length,
    });
  }
  return findings;
}

async function runAllChecks(): Promise<Finding[]> {
  const groups = await Promise.all([
    checkPersistenceContract(),
    checkCeilingConsequence(),
    checkStateOwners(),
    checkPlanLoss(),
    checkUnboundedRetry(),
    checkResourceLimit(),
    checkStoryGateBypass(),
  ]);
  return groups.flat();
}

async function persistFindings(runId: string, findings: Finding[]) {
  if (findings.length === 0) return;
  const rows = findings.map(f => ({
    run_id: runId,
    check_key: f.check_key,
    severity: f.severity,
    defect_class: f.defect_class,
    title: f.title,
    detail: f.detail ?? null,
    evidence: f.evidence ?? {},
    affected_count: f.affected_count ?? 0,
  }));
  await _sb.from("self_audit_findings").insert(rows);
}

async function mirrorCriticalToAlertLog(runId: string, findings: Finding[]) {
  const critical = findings.filter(f => f.severity === "critical");
  if (critical.length === 0) return;
  // Feed the existing alert_log path so the health-monitor digest + banner
  // pick these up without duplicating email code here.
  const rows = critical.map(f => ({
    alert_class: `audit_${f.defect_class}`,
    severity: "critical",
    title: `[nightly-audit] ${f.title}`,
    body: (f.detail ?? "") + `\n\nrun_id=${runId} check=${f.check_key}`,
    evidence: f.evidence ?? {},
  }));
  await _sb.from("alert_log").insert(rows);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "run";

  try {
    if (mode === "status") {
      const { data } = await _sb.from("self_audit_findings")
        .select("*").order("created_at", { ascending: false }).limit(50);
      return new Response(JSON.stringify({ latest: data ?? [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const runId = crypto.randomUUID();
    const findings = await runAllChecks();
    await persistFindings(runId, findings);
    await mirrorCriticalToAlertLog(runId, findings);

    const summary = {
      run_id: runId,
      total: findings.length,
      critical: findings.filter(f => f.severity === "critical").length,
      warning: findings.filter(f => f.severity === "warning").length,
      info:    findings.filter(f => f.severity === "info").length,
      by_class: Object.fromEntries(
        [...new Set(findings.map(f => f.defect_class))].map(c =>
          [c, findings.filter(f => f.defect_class === c).length])),
    };
    return new Response(JSON.stringify({ ok: true, ...summary, findings }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("nightly-self-audit failure:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
