// Multi-Book Autopilot Status Center.
// Shows one live card per Autopilot run so admins can see every book separately.
// Reads autopilot_pipeline_runs + latest active step per run (for subtask / attempts).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAdminData } from "@/lib/adminData";
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
  current_subtask: string | null;
  progress_percent: number;
  started_at: string;
  updated_at: string;
  last_heartbeat_at: string | null;
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

type EbookRow = {
  id: string;
  title: string | null;
  listing_status: string | null;
  final_quality_score: number | null;
  cover_url: string | null;
  cover_approved: boolean | null;
  pdf_url: string | null;
  pdf_status: string | null;
  pdf_generated_at: string | null;
};

type FilterKey = "all" | "running" | "auto_fixing" | "draft_uploaded" | "needs_admin" | "failed" | "completed";

const ACTIVE = ["starting", "running", "auto_fixing"];

// display status derived from run + ebook
type DisplayStatus =
  | "queued" | "running" | "auto_fixing" | "rendering_pdf" | "publishing"
  | "draft_uploaded" | "ready_to_publish"
  | "needs_admin" | "failed" | "paused" | "completed";

function displayStatus(run: RunRow, ebook: EbookRow | undefined): DisplayStatus {
  if (run.status === "needs_admin") return "needs_admin";
  if (run.status === "failed") return "failed";
  if (run.status === "paused") return "paused";
  if (run.status === "completed") {
    if (ebook?.listing_status === "live") return "ready_to_publish";
    if (ebook?.listing_status === "draft") return "draft_uploaded";
    return "completed";
  }
  if (run.status === "auto_fixing") return "auto_fixing";
  if (run.status === "starting") return "queued";
  const step = run.current_step ?? "";
  if (step === "pdf_render" || step === "pdf_layout") return "rendering_pdf";
  if (step === "publish_live") return "publishing";
  return "running";
}

const STATUS_STYLE: Record<DisplayStatus, { label: string; badge: string; border: string; bar: string }> = {
  queued:             { label: "Queued",              badge: "bg-slate-200 text-slate-900 border-slate-500",       border: "border-slate-400",   bar: "bg-slate-400" },
  running:            { label: "Running",             badge: "bg-sky-100 text-sky-900 border-sky-700",             border: "border-sky-700",     bar: "bg-sky-600" },
  auto_fixing:        { label: "Auto-Fixing",         badge: "bg-orange-100 text-orange-900 border-orange-700",    border: "border-orange-700",  bar: "bg-orange-500" },
  rendering_pdf:      { label: "Rendering PDF",       badge: "bg-sky-100 text-sky-900 border-sky-700",             border: "border-sky-700",     bar: "bg-sky-600" },
  publishing:  { label: "Publishing",   badge: "bg-sky-100 text-sky-900 border-sky-700",             border: "border-sky-700",     bar: "bg-sky-600" },
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
    try {
      const d = await fetchAdminData<{
        runs: RunRow[]; ebooks: EbookRow[]; steps: StepRow[];
      }>("autopilot_overview");
      setRuns(d.runs ?? []);
      const map: Record<string, EbookRow> = {};
      (d.ebooks ?? []).forEach((x) => { map[x.id] = x; });
      setEbooksById(map);
      const stepMap: Record<string, StepRow> = {};
      (d.steps ?? []).forEach((s) => { if (!stepMap[s.run_id]) stepMap[s.run_id] = s; });
      setActiveStepByRun(stepMap);
    } catch (err) {
      console.error("[AutopilotStatusCenter] load failed", err);
    }
  }

  async function loadSummary() {
    try {
      const d = await fetchAdminData<{
        daily_quota: number; produced_today: number; cost_today: number;
      }>("autopilot_overview");
      setDailyQuota(d.daily_quota ?? 0);
      setProducedToday(d.produced_today ?? 0);
      setCostToday(Number(d.cost_today ?? 0));
    } catch (err) {
      console.error("[AutopilotStatusCenter] summary failed", err);
    }
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
    const c = { running: 0, queued: 0, auto_fixing: 0, draft_uploaded: 0, needs_admin: 0, failed: 0, completed: 0, avgProgress: 0 };
    let activeCount = 0;
    let activeSum = 0;
    enriched.forEach(({ ds, run }) => {
      if (ds === "queued") c.queued++;
      else if (ds === "auto_fixing") c.auto_fixing++;
      else if (["running", "rendering_pdf", "publishing"].includes(ds)) c.running++;
      else if (ds === "draft_uploaded" || ds === "ready_to_publish") c.draft_uploaded++;
      else if (ds === "needs_admin") c.needs_admin++;
      else if (ds === "failed") c.failed++;
      else if (ds === "completed") c.completed++;
      if (["running", "rendering_pdf", "publishing", "auto_fixing"].includes(ds)) {
        activeCount++;
        activeSum += run.progress_percent ?? 0;
      }
    });
    c.avgProgress = activeCount > 0 ? Math.round(activeSum / activeCount) : 0;
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    const list = enriched.filter(({ ds }) => {
      switch (filter) {
        case "all": return true;
        case "running": return ["running", "rendering_pdf", "publishing"].includes(ds);
        case "auto_fixing": return ds === "auto_fixing";
        case "draft_uploaded": return ds === "draft_uploaded" || ds === "ready_to_publish";
        case "needs_admin": return ds === "needs_admin";
        case "failed": return ds === "failed";
        case "completed": return ds === "completed";
      }
    });
    const rank: Record<DisplayStatus, number> = {
      needs_admin: 0, failed: 1, auto_fixing: 2,
      running: 3, rendering_pdf: 3, publishing: 3,
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
            <h2 className="font-display text-base uppercase tracking-wide">Live Autopilot Overview</h2>
            <span className="ml-auto text-[10px] font-mono uppercase text-muted-foreground">Live · updates every 3s</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2 text-xs">
            <SummaryTile label="Daily Quota" value={dailyQuota || "—"} />
            <SummaryTile label="Completed" value={`${producedToday}/${dailyQuota || "—"}`} tone="text-emerald-800" />
            <SummaryTile label="Running" value={counts.running} tone="text-sky-800" />
            <SummaryTile label="Queued" value={counts.queued} />
            <SummaryTile label="Auto-Fixing" value={counts.auto_fixing} tone={counts.auto_fixing ? "text-orange-800" : ""} />
            <SummaryTile label="Needs Admin" value={counts.needs_admin} tone={counts.needs_admin ? "text-red-800" : ""} />
            <SummaryTile label="Failed" value={counts.failed} tone={counts.failed ? "text-red-800" : ""} />
            <SummaryTile label="Drafts" value={counts.draft_uploaded} tone={counts.draft_uploaded ? "text-emerald-800" : ""} />
            <SummaryTile label="Avg Progress" value={`${counts.avgProgress}%`} />
            <SummaryTile label="AI Cost Today" value={`$${costToday.toFixed(2)}`} />
          </div>
        </CardContent>
      </Card>

      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-center gap-1">
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
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={view === "cards" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setView("cards")}>
            <LayoutGrid className="size-3 mr-1" />Cards
          </Button>
          <Button size="sm" variant={view === "table" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setView("table")}>
            <Rows3 className="size-3 mr-1" />Table
          </Button>
        </div>
      </div>

      {/* Per-book */}
      {view === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(({ run, ebook, ds, step }) => (
            <RunCard key={run.id} run={run} ebook={ebook} ds={ds} step={step} now={now} />
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground p-3">No runs match this filter.</p>
          )}
        </div>
      ) : (
        <RunTable rows={filtered} now={now} />
      )}
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
  const subtask = run.current_subtask
    ?? (typeof meta.current_subtask === "string"
      ? meta.current_subtask
      : typeof meta.subtask === "string" ? meta.subtask : null);
  const attempts = step?.auto_fix_attempts ?? 0;
  const maxAttempts = step?.max_auto_fix_attempts ?? 3;
  const active = ACTIVE.includes(run.status);
  const heartbeatIso = run.last_heartbeat_at ?? run.updated_at;
  const updatedSec = Math.floor((now - new Date(heartbeatIso).getTime()) / 1000);
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
          {ebook?.listing_status && (
            <p>Listing: <span className="font-mono">{ebook.listing_status}</span></p>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {elapsedLabel(run.started_at, run.completed_at, now)} elapsed
          </span>
          <span>Updated {agoLabel(heartbeatIso, now)}</span>
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

        <PreviewTask ebook={ebook} ds={ds} />

        <div className="pt-1">
          <Link to={`/admin/autopilot/run/${run.id}`}>
            <Button size="sm" variant="outline" className="h-7 text-xs w-full">View Details →</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewTask({ ebook, ds }: { ebook: EbookRow | undefined; ds: DisplayStatus }) {
  if (!ebook) return null;
  const coverReady = !!ebook.cover_url;
  const pdfReady = !!ebook.pdf_url;
  // Infer generating state from the current pipeline step / display status
  const generatingCover = !coverReady && ["running", "auto_fixing"].includes(ds);
  const generatingPdf = coverReady && !pdfReady && (
    ds === "rendering_pdf" || ds === "auto_fixing" || ds === "running"
  );
  const coverFailed = !coverReady && ds === "needs_admin";
  const pdfFailed = !pdfReady && (ebook.pdf_status === "failed" || ds === "failed");

  return (
    <div className="border-t border-foreground/10 pt-2 mt-1">
      <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide mb-1">Preview Task</p>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {/* Cover */}
        <div className="flex items-start gap-2">
          {coverReady ? (
            <a href={ebook.cover_url ?? "#"} target="_blank" rel="noopener noreferrer"
               className="block w-10 h-14 border border-foreground/20 overflow-hidden shrink-0 hover:ring-2 hover:ring-sky-400">
              <img src={ebook.cover_url ?? ""} alt="cover" className="w-full h-full object-cover" />
            </a>
          ) : (
            <div className="w-10 h-14 border border-dashed border-foreground/30 bg-muted/40 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium">Cover</p>
            {coverReady ? (
              <a href={ebook.cover_url ?? "#"} target="_blank" rel="noopener noreferrer"
                 className="text-sky-700 hover:underline">Open Preview</a>
            ) : coverFailed ? (
              <span className="text-red-800">Preview failed</span>
            ) : generatingCover ? (
              <span className="text-orange-800">Generating…</span>
            ) : (
              <span className="text-muted-foreground">Pending</span>
            )}
          </div>
        </div>
        {/* PDF */}
        <div className="flex items-start gap-2">
          <div className={`w-10 h-14 border shrink-0 flex items-center justify-center text-[9px] font-mono ${pdfReady ? "border-foreground/40 bg-emerald-50 text-emerald-800" : "border-dashed border-foreground/30 bg-muted/40 text-muted-foreground"}`}>
            PDF
          </div>
          <div className="min-w-0">
            <p className="font-medium">PDF</p>
            {pdfReady ? (
              <a href={ebook.pdf_url ?? "#"} target="_blank" rel="noopener noreferrer"
                 className="text-sky-700 hover:underline">Open Preview</a>
            ) : pdfFailed ? (
              <span className="text-red-800">Preview failed</span>
            ) : generatingPdf ? (
              <span className="text-orange-800">Generating…</span>
            ) : (
              <span className="text-muted-foreground">Pending</span>
            )}
            {pdfReady && ebook.pdf_generated_at && (
              <p className="text-[10px] text-muted-foreground">
                {new Date(ebook.pdf_generated_at).toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type RunRowData = { run: RunRow; ebook: EbookRow | undefined; ds: DisplayStatus; step: StepRow | undefined };

function RunTable({ rows, now }: { rows: RunRowData[]; now: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground p-3">No runs match this filter.</p>;
  }
  return (
    <div className="border-2 border-foreground overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 font-mono uppercase text-[10px] tracking-wide">
          <tr>
            <th className="p-2 text-left">Ebook</th>
            <th className="p-2 text-left">Status</th>
            <th className="p-2 text-left w-32">Progress</th>
            <th className="p-2 text-left">Step</th>
            <th className="p-2 text-left">Current Action</th>
            <th className="p-2 text-left">Auto-Fix</th>
            <th className="p-2 text-left">Listing</th>
            <th className="p-2 text-left">Preview</th>
            <th className="p-2 text-left">Updated</th>
            <th className="p-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ run, ebook, ds, step }) => {
            const style = STATUS_STYLE[ds];
            const stepIdx = stepIndex(run.current_step);
            const label = run.current_step_label ?? stepLabel(run.current_step);
            const title = ebook?.title || (run.ebook_id ? "Untitled" : "New Run");
            const attempts = step?.auto_fix_attempts ?? 0;
            const maxAttempts = step?.max_auto_fix_attempts ?? 3;
            const heartbeatIso = run.last_heartbeat_at ?? run.updated_at;
            const updatedSec = Math.floor((now - new Date(heartbeatIso).getTime()) / 1000);
            const stalled = ACTIVE.includes(run.status) && updatedSec > 300;
            const subtask = run.current_subtask
              ?? (typeof (step?.metadata_json as Record<string, unknown> | null)?.current_subtask === "string"
                ? String((step!.metadata_json as Record<string, unknown>).current_subtask) : null);
            return (
              <tr key={run.id} className={`border-t border-foreground/10 hover:bg-muted/30 ${stalled ? "bg-red-50/40" : ""}`}>
                <td className="p-2 max-w-[220px]">
                  <p className="font-medium line-clamp-1">{title}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{run.id.slice(0, 8)}</p>
                </td>
                <td className="p-2">
                  <span className={`text-[10px] font-mono uppercase border-2 px-1.5 py-0.5 ${style.badge}`}>{style.label}</span>
                  {stalled && <p className="text-[10px] text-red-800 mt-0.5">Stalled {Math.floor(updatedSec / 60)}m</p>}
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 flex-1 bg-muted border border-foreground/10 overflow-hidden">
                      <div className={`h-full ${style.bar}`} style={{ width: `${Math.max(2, run.progress_percent)}%` }} />
                    </div>
                    <span className="font-mono text-[10px] w-8 text-right">{run.progress_percent}%</span>
                  </div>
                </td>
                <td className="p-2">
                  <span className="text-muted-foreground">{stepIdx}/{TOTAL_STEPS}</span> <span className="font-medium">{label}</span>
                </td>
                <td className="p-2 max-w-[280px]">
                  <p className="line-clamp-1">{run.current_action_message ?? "—"}</p>
                  {subtask && <p className="text-[10px] text-muted-foreground line-clamp-1">↳ {subtask}</p>}
                </td>
                <td className="p-2">{attempts > 0 ? <span className="text-orange-800">{attempts}/{maxAttempts}</span> : "—"}</td>
                <td className="p-2 font-mono">{ebook?.listing_status ?? "—"}</td>
                <td className="p-2">
                  <div className="flex flex-col gap-0.5 text-[10px]">
                    {ebook?.cover_url
                      ? <a href={ebook.cover_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">Cover ↗</a>
                      : <span className="text-muted-foreground">Cover: {["running","auto_fixing","rendering_pdf"].includes(ds) ? "gen…" : "—"}</span>}
                    {ebook?.pdf_url
                      ? <a href={ebook.pdf_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">PDF ↗</a>
                      : <span className="text-muted-foreground">PDF: {ds === "rendering_pdf" ? "gen…" : (ebook?.pdf_status === "failed" ? "failed" : "—")}</span>}
                  </div>
                </td>
                <td className="p-2 font-mono text-muted-foreground">{agoLabel(heartbeatIso, now)}</td>
                <td className="p-2 text-right">
                  <Link to={`/admin/autopilot/run/${run.id}`}>
                    <Button size="sm" variant="outline" className="h-6 text-[11px]">View →</Button>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default AutopilotStatusCenter;
