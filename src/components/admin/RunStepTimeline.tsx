// Vertical timeline of all Autopilot pipeline steps for one run.
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

export function RunStepTimeline({ steps }: { steps: RunStepRow[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => {
        const v = statusVisual(s.status);
        const Icon = v.Icon;
        const duration = formatDuration(s.duration_ms);
        return (
          <li key={s.id} className={`border-2 ${v.border} ${v.bg} p-3 flex gap-3`}>
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
                {duration && (
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">{duration}</span>
                )}
              </div>
              {s.message && <p className="text-xs text-muted-foreground line-clamp-3">{s.message}</p>}
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
