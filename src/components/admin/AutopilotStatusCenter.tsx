// Multi-Book Autopilot Status Center.
// Shows one live card per Autopilot run so admins can see every book separately.
// Reads autopilot_pipeline_runs + latest active step per run (for subtask / attempts).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, Clock, LayoutGrid, Rows3 } from "lucide-react";
import { stepLabel, AUTOPILOT_STEPS, TOTAL_STEPS } from "@/lib/autopilot-steps";

type RunRow = {
  id: string;
  ebook_id: string | null;
  status: string;
  current_step: string | null;
  current_step_label: string | null;
  current_action_message: string | null;
  progress_percent: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  admin_needed_reason: string | null;
  error_message: string | null;
  pause_requested: boolean;
  mode: string | null;
  test_mode: boolean;
};

type StepRow = {
  run_id: string;
  step_name: string;
  step_label: string | null;
  status: string;
  score: number | null;
  required_score: number | null;
  auto_fix_attempts: number | null;
  max_auto_fix_attempts: number | null;
  metadata_json: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
};

type EbookRow = { id: string; title: string | null; shopify_status: string | null; shopify_product_id: string | null; final_quality_score: number | null };

type FilterKey = "all" | "running" | "auto_fixing" | "draft_uploaded" | "needs_admin" | "failed" | "completed";

const ACTIVE = ["starting", "running", "auto_fixing"];

// display status derived from run + ebook
type DisplayStatus =
  | "queued" | "running" | "auto_fixing" | "rendering_pdf" | "uploading_shopify"
  | "verifying_shopify" | "draft_uploaded" | "ready_to_publish"
  | "needs_admin" | "failed" | "paused" | "completed";

function displayStatus(run: RunRow, ebook: EbookRow | undefined): DisplayStatus {
  if (run.status === "needs_admin") return "needs_admin";
  if (run.status === "failed") return "failed";
  if (run.status === "paused") return "paused";
  if (run.status === "completed") {
    if (ebook?.shopify_status === "published") return "ready_to_publish";
    if (ebook?.shopify_product_id) return "draft_uploaded";
    return "completed";
  }
  if (run.status === "auto_fixing") return "auto_fixing";
  if (run.status === "starting") return "queued";
  const step = run.current_step ?? "";
  if (step === "pdf_render" || step === "pdf_layout") return "rendering_pdf";
  if (step === "shopify_draft") return "uploading_shopify";
  if (step === "shopify_verify") return "verifying_shopify";
  return "running";
}

const STATUS_STYLE: Record<DisplayStatus, { label: string; badge: string; border: string; bar: string }> = {
  queued:             { label: "Queued",              badge: "bg-slate-200 text-slate-900 border-slate-500",       border: "border-slate-400",   bar: "bg-slate-400" },
  running:            { label: "Running",             badge: "bg-sky-100 text-sky-900 border-sky-700",             border: "border-sky-700",     bar: "bg-sky-600" },
  auto_fixing:        { label: "Auto-Fixing",         badge: "bg-orange-100 text-orange-900 border-orange-700",    border: "border-orange-700",  bar: "bg-orange-500" },
  rendering_pdf:      { label: "Rendering PDF",       badge: "bg-sky-100 text-sky-900 border-sky-700",             border: "border-sky-700",     bar: "bg-sky-600" },
  uploading_shopify:  { label: "Uploading Shopify",   badge: "bg-sky-100 text-sky-900 border-sky-700",             border: "border-sky-700",     bar: "bg-sky-600" },
  verifying_shopify:  { label: "Verifying Shopify",   badge: "bg-sky-100 text-sky-900 border-sky-700",             border: "border-sky-700",     bar: "bg-sky-600" },
  draft_uploaded:     { label: "Draft Uploaded",      badge: "bg-emerald-100 text-emerald-900 border-emerald-700", border: "border-emerald-700", bar: "bg-emerald-600" },
  ready_to_publish:   { label: "Ready to Publish",    badge: "bg-emerald-200 text-emerald-950 border-emerald-800", border: "border-emerald-700", bar: "bg-emerald-600" },
  needs_admin:        { label: "Needs Admin",         badge: "bg-red-100 text-red-900 border-red-700",             border: "border-red-700",     bar: "bg-red-600" },
  failed:             { label: "Failed",              badge: "bg-red-100 text-red-900 border-red-700",             border: "border-red-700",     bar: "bg-red-600" },
  paused:             { label: "Paused",              badge: "bg-yellow-100 text-yellow-900 border-yellow-700",    border: "border-yellow-700",  bar: "bg-yellow-500" },
  completed:          { label: "Completed",           badge: "bg-emerald-100 text-emerald-900 border-emerald-700", border: "border-emerald-700", bar: "bg-emerald-600" },
};

function stepIndex(name: string | null | undefined): number {
  if (!name) return 0;
  const def = AUTOPILOT_STEPS.find((s) => s.name === name);
  return def?.order ?? 0;
}

function agoLabel(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function elapsedLabel(startIso: string, endIso: string | null, now: number): string {
  const end = endIso ? new Date(endIso).getTime() : now;
  const s = Math.max(0, Math.floor((end - new Date(startIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function AutopilotStatusCenter() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [ebooksById, setEbooksById] = useState<Record<string, EbookRow>>({});
  const [activeStepByRun, setActiveStepByRun] = useState<Record<string, StepRow>>({});
  const [costToday, setCostToday] = useState(0);
  const [dailyQuota, setDailyQuota] = useState<number>(0);
  const [producedToday, setProducedToday] = useState(0);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [now, setNow] = useState(Date.now());

  async function load() {
    // Show recent (last 24h) + all currently active runs.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: r } = await supabase
      .from("autopilot_pipeline_runs")
      .select("id,ebook_id,status,current_step,current_step_label,current_action_message,progress_percent,started_at,updated_at,completed_at,admin_needed_reason,error_message,pause_requested,mode,test_mode")
      .or(`started_at.gte.${since},status.in.(starting,running,auto_fixing,needs_admin)`)
      .order("started_at", { ascending: false })
      .limit(50);
    const runsData = (r ?? []) as RunRow[];
    setRuns(runsData);

    const ebookIds = Array.from(new Set(runsData.map((x) => x.ebook_id).filter(Boolean))) as string[];
    if (ebookIds.length) {
      const { data: eb } = await supabase
        .from("ebooks")
        .select("id,title,shopify_status,shopify_product_id,final_quality_score")
        .in("id", ebookIds);
      const map: Record<string, EbookRow> = {};
      (eb ?? []).forEach((x) => { map[(x as EbookRow).id] = x as EbookRow; });
      setEbooksById(map);
    }

    // Latest active/running step per run — for subtask + auto-fix attempts.
    const activeRunIds = runsData.filter((x) => ACTIVE.includes(x.status)).map((x) => x.id);
    if (activeRunIds.length) {
      const { data: sr } = await supabase
        .from("autopilot_pipeline_steps")
        .select("run_id,step_name,step_label,status,score,required_score,auto_fix_attempts,max_auto_fix_attempts,metadata_json,started_at,completed_at")
        .in("run_id", activeRunIds)
        .in("status", ["running", "auto_fixing"])
        .order("started_at", { ascending: false });
      const map: Record<string, StepRow> = {};
      (sr ?? []).forEach((row) => { const s = row as StepRow; if (!map[s.run_id]) map[s.run_id] = s; });
      setActiveStepByRun(map);
    } else {
      setActiveStepByRun({});
    }
  }

  async function loadSummary() {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [{ data: settings }, { count: produced }, { data: costs }] = await Promise.all([
      supabase.from("generation_settings").select("daily_quota").eq("id", 1).maybeSingle(),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
      supabase.from("cost_log").select("cost_usd").gte("created_at", since.toISOString()),
    ]);
    setDailyQuota((settings as { daily_quota?: number } | null)?.daily_quota ?? 0);
    setProducedToday(produced ?? 0);
    setCostToday((costs ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0));
  }

  useEffect(() => {
    load();
    loadSummary();
    const p1 = setInterval(load, 3000);
    const p2 = setInterval(loadSummary, 15_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const channel = supabase
      .channel("autopilot-status-center")
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_pipeline_runs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_pipeline_steps" }, () => load())
      .subscribe();
    return () => {
      clearInterval(p1); clearInterval(p2); clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, []);

  // Build summary counts.
  const enriched = useMemo(() => runs.map((r) => {
    const ebook = r.ebook_id ? ebooksById[r.ebook_id] : undefined;
    const ds = displayStatus(r, ebook);
    return { run: r, ebook, ds, step: activeStepByRun[r.id] };
  }), [runs, ebooksById, activeStepByRun]);

  const counts = useMemo(() => {
    const c = { running: 0, queued: 0, auto_fixing: 0, draft_uploaded: 0, needs_admin: 0, failed: 0, completed: 0 };
    enriched.forEach(({ ds }) => {
      if (ds === "queued") c.queued++;
      else if (ds === "auto_fixing") c.auto_fixing++;
      else if (["running", "rendering_pdf", "uploading_shopify", "verifying_shopify"].includes(ds)) c.running++;
      else if (ds === "draft_uploaded" || ds === "ready_to_publish") c.draft_uploaded++;
      else if (ds === "needs_admin") c.needs_admin++;
      else if (ds === "failed") c.failed++;
      else if (ds === "completed") c.completed++;
    });
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    const list = enriched.filter(({ ds }) => {
      switch (filter) {
        case "all": return true;
        case "running": return ["running", "rendering_pdf", "uploading_shopify", "verifying_shopify"].includes(ds);
        case "auto_fixing": return ds === "auto_fixing";
        case "draft_uploaded": return ds === "draft_uploaded" || ds === "ready_to_publish";
        case "needs_admin": return ds === "needs_admin";
        case "failed": return ds === "failed";
        case "completed": return ds === "completed";
      }
    });
    const rank: Record<DisplayStatus, number> = {
      needs_admin: 0, failed: 1, auto_fixing: 2,
      running: 3, rendering_pdf: 3, uploading_shopify: 3, verifying_shopify: 3,
      queued: 4, paused: 5, completed: 6, draft_uploaded: 7, ready_to_publish: 7,
    };
    return list.sort((a, b) => {
      const d = rank[a.ds] - rank[b.ds];
      if (d !== 0) return d;
      return new Date(b.run.updated_at).getTime() - new Date(a.run.updated_at).getTime();
    });
  }, [enriched, filter]);

  if (runs.length === 0) return null;

  const FILTERS: { key: FilterKey; label: string; n?: number }[] = [
    { key: "all", label: "All", n: enriched.length },
    { key: "running", label: "Running", n: counts.running },
    { key: "auto_fixing", label: "Auto-Fixing", n: counts.auto_fixing },
    { key: "draft_uploaded", label: "Draft Uploaded", n: counts.draft_uploaded },
    { key: "needs_admin", label: "Needs Admin", n: counts.needs_admin },
    { key: "failed", label: "Failed", n: counts.failed },
  ];

  return (
    <section className="space-y-3">
      {/* Batch summary */}
      <Card className="border-2 border-foreground">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="size-4 text-sky-700" />
            <h2 className="font-display text-base uppercase tracking-wide">Autopilot Runs</h2>
            <span className="ml-auto text-[10px] font-mono uppercase text-muted-foreground">Live · updates every 4s</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            <SummaryTile label="Completed" value={`${producedToday}/${dailyQuota || "—"}`} tone="text-emerald-800" />
            <SummaryTile label="Running" value={counts.running} tone="text-sky-800" />
            <SummaryTile label="Queued" value={counts.queued} />
            <SummaryTile label="Auto-Fixing" value={counts.auto_fixing} tone={counts.auto_fixing ? "text-orange-800" : ""} />
            <SummaryTile label="Needs Admin" value={counts.needs_admin} tone={counts.needs_admin ? "text-red-800" : ""} />
            <SummaryTile label="AI Cost Today" value={`$${costToday.toFixed(2)}`} />
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilter(f.key)}
          >
            {f.label}{typeof f.n === "number" ? ` (${f.n})` : ""}
          </Button>
        ))}
      </div>

      {/* Per-book cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map(({ run, ebook, ds, step }) => (
          <RunCard key={run.id} run={run} ebook={ebook} ds={ds} step={step} now={now} />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground p-3">No runs match this filter.</p>
        )}
      </div>
    </section>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="border border-foreground/20 p-2">
      <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide">{label}</p>
      <p className={`font-display text-xl leading-none ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function RunCard({
  run, ebook, ds, step, now,
}: {
  run: RunRow;
  ebook: EbookRow | undefined;
  ds: DisplayStatus;
  step: StepRow | undefined;
  now: number;
}) {
  const style = STATUS_STYLE[ds];
  const stepIdx = stepIndex(run.current_step);
  const title = ebook?.title || (run.ebook_id ? "Untitled" : "New Run");
  const label = run.current_step_label ?? stepLabel(run.current_step);
  const meta = (step?.metadata_json ?? {}) as Record<string, unknown>;
  const subtask = typeof meta.current_subtask === "string"
    ? meta.current_subtask
    : typeof meta.subtask === "string" ? meta.subtask : null;
  const attempts = step?.auto_fix_attempts ?? 0;
  const maxAttempts = step?.max_auto_fix_attempts ?? 3;
  const active = ACTIVE.includes(run.status);
  const updatedSec = Math.floor((now - new Date(run.updated_at).getTime()) / 1000);
  const stalled = active && updatedSec > 300;
  const slow = active && !stalled && updatedSec > 90;

  return (
    <Card className={`border-2 ${style.border} ${stalled ? "ring-2 ring-red-400" : slow ? "ring-2 ring-orange-300" : ""}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm line-clamp-1">{title}</p>
            <p className="text-[10px] font-mono text-muted-foreground">
              Run {run.id.slice(0, 8)}{run.test_mode ? " · test" : ""}
            </p>
          </div>
          <span className={`text-[10px] font-mono uppercase tracking-wide border-2 px-2 py-0.5 ${style.badge}`}>
            {style.label}
          </span>
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <span>
              <span className="text-muted-foreground">Step {stepIdx}/{TOTAL_STEPS}: </span>
              <span className="font-medium">{label}</span>
            </span>
            <span className="font-mono">{run.progress_percent}%</span>
          </div>
          <div className="h-2 bg-muted border border-foreground/10 overflow-hidden">
            <div className={`h-full ${style.bar} transition-all`} style={{ width: `${Math.max(2, run.progress_percent)}%` }} />
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          {run.current_action_message && (
            <p className="line-clamp-2"><span className="text-foreground/70">Current: </span>{run.current_action_message}</p>
          )}
          {subtask && (
            <p className="line-clamp-1">↳ {subtask}</p>
          )}
          {attempts > 0 && (
            <p className="text-orange-800">Auto-fix attempt {attempts}/{maxAttempts}</p>
          )}
          {ebook?.final_quality_score != null && (
            <p>QC score: <span className="font-mono">{ebook.final_quality_score}</span></p>
          )}
          {ebook?.shopify_product_id && (
            <p>Shopify: <span className="font-mono">{ebook.shopify_status ?? "draft"}</span></p>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {elapsedLabel(run.started_at, run.completed_at, now)} elapsed
          </span>
          <span>Updated {agoLabel(run.updated_at, now)}</span>
        </div>

        {stalled && (
          <div className="flex items-center gap-1 text-[11px] text-red-800">
            <AlertTriangle className="size-3" /> Possibly stalled — no heartbeat for {Math.floor(updatedSec / 60)}m
          </div>
        )}
        {ds === "needs_admin" && run.admin_needed_reason && (
          <div className="flex items-start gap-1 text-[11px] text-red-800">
            <AlertTriangle className="size-3 mt-0.5" /> {run.admin_needed_reason}
          </div>
        )}
        {ds === "failed" && run.error_message && (
          <div className="text-[11px] text-red-800 line-clamp-2">{run.error_message}</div>
        )}

        <div className="pt-1">
          <Link to={`/admin/autopilot/run/${run.id}`}>
            <Button size="sm" variant="outline" className="h-7 text-xs w-full">View Details →</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default AutopilotStatusCenter;
