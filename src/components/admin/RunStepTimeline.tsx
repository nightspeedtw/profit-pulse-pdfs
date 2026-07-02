// Vertical timeline of all Autopilot pipeline steps for one run.
import { useEffect, useState } from "react";
import { Check, Loader2, AlertTriangle, Circle, MinusCircle, Wrench, X } from "lucide-react";
import { STEP_STATUS_LABEL } from "@/lib/autopilot-steps";

export interface RunStepRow {
  id: string;
  step_order: number;
  step_name: string;
  step_label: string;
  status: string;
  message: string | null;
  score: number | null;
  required_score: number | null;
  auto_fix_attempts: number;
  max_auto_fix_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  updated_at?: string | null;
  metadata_json?: {
    current_subtask?: string;
    subtask_seq?: number;
    message?: string;
    last_heartbeat_at?: string;
    elapsed_ms?: number;
    attempt?: number;
    chapter_index?: number;
    total_words?: number;
    score?: number | null;
    [k: string]: unknown;
  } | null;
}

function statusVisual(status: string) {
  switch (status) {
    case "running":          return { Icon: Loader2, color: "text-sky-700", bg: "bg-sky-50", border: "border-sky-700", spin: true };
    case "passed":           return { Icon: Check, color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-700" };
    case "passed_existing":  return { Icon: Check, color: "text-emerald-700", bg: "bg-emerald-50/60", border: "border-emerald-700/60" };
    case "auto_fixing":      return { Icon: Wrench, color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-700" };
    case "failed":           return { Icon: X, color: "text-red-700", bg: "bg-red-50", border: "border-red-700" };
    case "needs_admin":      return { Icon: AlertTriangle, color: "text-red-700", bg: "bg-red-50", border: "border-red-700" };
    case "skipped":          return { Icon: MinusCircle, color: "text-muted-foreground", bg: "bg-muted/30", border: "border-foreground/15" };
    default:                 return { Icon: Circle, color: "text-muted-foreground", bg: "", border: "border-foreground/15" };
  }
}

function formatDuration(ms: number | null) {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function useNowTick(intervalMs = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

function formatAge(ms: number) {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s ago` : `${m}m ago`;
}

export function RunStepTimeline({ steps }: { steps: RunStepRow[] }) {
  const now = useNowTick(5000);
  return (
    <ol className="space-y-2">
      {steps.map((s) => {
        const v = statusVisual(s.status);
        const Icon = v.Icon;
        const duration = formatDuration(s.duration_ms);
        const isRunning = s.status === "running" || s.status === "auto_fixing";
        const heartbeatIso = s.metadata_json?.last_heartbeat_at ?? s.updated_at ?? null;
        const heartbeatAge = isRunning ? ageMs(heartbeatIso, now) : null;
        const runningMs = isRunning ? ageMs(s.started_at ?? null, now) : null;
        const stalled = heartbeatAge != null && heartbeatAge > 5 * 60_000;
        const slow = heartbeatAge != null && heartbeatAge > 60_000 && !stalled;
        const subtask = s.metadata_json?.current_subtask;
        return (
          <li key={s.id} className={`border-2 ${stalled ? "border-red-700 bg-red-50/40" : slow ? "border-orange-700 bg-orange-50/40" : `${v.border} ${v.bg}`} p-3 flex gap-3`}>
            <div className="shrink-0 mt-0.5">
              <Icon className={`size-5 ${v.color} ${v.spin ? "animate-spin" : ""}`} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-muted-foreground">#{String(s.step_order).padStart(2, "0")}</span>
                <span className="font-medium text-sm">{s.step_label}</span>
                <span className={`text-[10px] font-mono uppercase ${v.color}`}>
                  {STEP_STATUS_LABEL[s.status] ?? s.status}
                </span>
                {subtask && isRunning && (
                  <span className="text-[10px] font-mono px-1 py-0.5 bg-sky-100 text-sky-800 rounded">
                    {subtask}
                  </span>
                )}
                {s.status === "auto_fixing" && (
                  <span className="text-[10px] font-mono text-orange-700">
                    attempt {s.auto_fix_attempts}/{s.max_auto_fix_attempts}
                  </span>
                )}
                {s.score != null && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    score {s.score}{s.required_score != null ? ` / req ${s.required_score}` : ""}
                  </span>
                )}
                {isRunning && runningMs != null && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    elapsed {formatDuration(runningMs)}
                  </span>
                )}
                {isRunning && heartbeatAge != null && (
                  <span className={`text-[10px] font-mono ${stalled ? "text-red-700 font-bold" : slow ? "text-orange-700" : "text-muted-foreground"}`}>
                    heartbeat {formatAge(heartbeatAge)}
                  </span>
                )}
                {duration && (
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">{duration}</span>
                )}
              </div>
              {s.message && <p className="text-xs text-muted-foreground line-clamp-3">{s.message}</p>}
              {stalled && (
                <p className="text-xs text-red-700 font-medium">
                  ⚠ No heartbeat for {formatAge(heartbeatAge!)}. This step looks stalled — try Resume Pipeline.
                </p>
              )}
              {slow && !stalled && (
                <p className="text-xs text-orange-700">
                  This step is taking longer than expected. Current subtask: {subtask ?? "unknown"}.
                </p>
              )}
              {s.error_message && s.status !== "auto_fixing" && (
                <p className="text-xs text-red-700 font-mono line-clamp-3">{s.error_message}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
}
