// Autopilot Run Details page — live timeline + admin-needed panel + final report.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Activity, RotateCcw } from "lucide-react";
import { RunStepTimeline, type RunStepRow } from "@/components/admin/RunStepTimeline";
import { RunFinalReport, type RunSummary } from "@/components/admin/RunFinalReport";
import { AdminNeededPanel, type AdminNeededState } from "@/components/admin/AdminNeededPanel";
import { PricingPanel, type PricingReportShape } from "@/components/admin/PricingPanel";
import { RUN_STATUS_LABEL } from "@/lib/autopilot-steps";
import { toast } from "sonner";

interface RunRow {
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
  failed_at: string | null;
  admin_needed_reason: string | null;
  error_message: string | null;
  summary_json: RunSummary | null;
  pause_requested: boolean;
  test_mode: boolean;
  mode: string | null;
}

export default function AutopilotRun() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<RunRow | null>(null);
  const [steps, setSteps] = useState<RunStepRow[]>([]);
  const [ebook, setEbook] = useState<AdminNeededState | null>(null);
  const [totalCost, setTotalCost] = useState(0);

  async function loadAll() {
    if (!runId) return;
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from("autopilot_pipeline_runs").select("*").eq("id", runId).maybeSingle(),
      supabase.from("autopilot_pipeline_steps").select("*").eq("run_id", runId).order("step_order"),
    ]);
    setRun((r as RunRow | null) ?? null);
    setSteps((s as RunStepRow[]) ?? []);
    if (r?.ebook_id) {
      const [{ data: e }, { data: costs }] = await Promise.all([
        supabase.from("ebooks").select("*").eq("id", r.ebook_id).maybeSingle(),
        supabase.from("cost_log").select("cost_usd").eq("ebook_id", r.ebook_id),
      ]);
      setEbook(((e as unknown) as AdminNeededState | null) ?? null);
      setTotalCost((costs ?? []).reduce((acc, row) => acc + Number(row.cost_usd ?? 0), 0));
    }
  }

  useEffect(() => {
    loadAll();
    if (!runId) return;
    const poll = setInterval(loadAll, 5000);
    const channel = supabase
      .channel(`autopilot-run-${runId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_pipeline_runs", filter: `id=eq.${runId}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_pipeline_steps", filter: `run_id=eq.${runId}` }, loadAll)
      .subscribe();
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (!run) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading run…
      </div>
    );
  }

  const failedGates = steps.filter((s) => s.status === "passed" && s.auto_fix_attempts > 0).map((s) => s.step_label);
  const autoFixAttempts = steps.reduce((acc, s) => acc + (s.auto_fix_attempts ?? 0), 0);
  const isActive = ["starting", "running", "auto_fixing"].includes(run.status);

  async function requestPause() {
    if (!run) return;
    const { error } = await supabase.from("autopilot_pipeline_runs").update({ pause_requested: true }).eq("id", run.id);
    if (error) toast.error(error.message); else toast.success("Pause requested");
    loadAll();
  }

  return (
    <div className="max-w-5xl space-y-6 p-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="size-4 mr-1" />Command Center</Button></Link>
        <Link to="/admin#live"><Button size="sm" variant="default"><Activity className="size-4 mr-1" />ดูสถานะรันตอนนี้</Button></Link>
        <span className="text-xs font-mono text-muted-foreground">Run {run.id.slice(0, 8)}</span>
      </div>

      <Card className="border-2 border-foreground">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="font-display text-2xl uppercase tracking-wide">
              {RUN_STATUS_LABEL[run.status] ?? run.status}
            </h1>
            {run.test_mode && <span className="text-[10px] font-mono uppercase border border-foreground/30 px-1 py-0.5">Test mode</span>}
            <span className="ml-auto text-xs font-mono text-muted-foreground">
              Started {new Date(run.started_at).toLocaleString()} · Updated {new Date(run.updated_at).toLocaleTimeString()}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-sm">
                <span className="text-muted-foreground">Current step: </span>
                <span className="font-medium">{run.current_step_label ?? "—"}</span>
              </span>
              <span className="font-mono text-xs">{run.progress_percent}%</span>
            </div>
            <div className="h-2 bg-muted border border-foreground/10 overflow-hidden">
              <div className="h-full bg-sky-600 transition-all" style={{ width: `${Math.max(2, run.progress_percent)}%` }} />
            </div>
            {run.current_action_message && <p className="text-xs text-muted-foreground">{run.current_action_message}</p>}
          </div>
          {isActive && (
            <Button size="sm" variant="outline" disabled={run.pause_requested} onClick={requestPause}>
              {run.pause_requested ? "Pause requested…" : "Pause After Current Step"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Admin needed panel */}
      {(run.status === "needs_admin" || run.status === "failed") && ebook && (
        <AdminNeededPanel ebook={ebook} onChanged={loadAll} />
      )}
      {(run.status === "needs_admin" || run.status === "failed") && !ebook && (
        <Card className="border-2 border-red-700 bg-red-50/40">
          <CardContent className="p-5 space-y-2">
            <h2 className="font-display text-lg uppercase tracking-wide">Pipeline Stopped</h2>
            <p className="text-sm">{run.admin_needed_reason ?? run.error_message ?? "No additional detail."}</p>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card className="border-2 border-foreground">
        <CardContent className="p-5 space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-widest">Step timeline</h2>
          <RunStepTimeline steps={steps} />
        </CardContent>
      </Card>

      {/* Pricing engine */}
      {run.ebook_id && (
        <PricingPanel
          ebookId={run.ebook_id}
          report={((ebook as any)?.pricing_report ?? null) as PricingReportShape | null}
          livePrice={(ebook as any)?.price ?? null}
          confidence={(ebook as any)?.price_confidence_score ?? null}
          onRecompute={loadAll}
        />
      )}

      {/* Final report */}
      {run.status === "completed" && (
        <RunFinalReport
          summary={(run.summary_json ?? {}) as RunSummary}
          totalCost={totalCost}
          autoFixAttempts={autoFixAttempts}
          failedGates={failedGates}
        />
      )}
    </div>
  );
}
