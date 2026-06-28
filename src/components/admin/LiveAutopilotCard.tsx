// Live status card shown on the Command Center whenever an Autopilot run is active.
// Subscribes to autopilot_pipeline_runs via Supabase Realtime; falls back to 4s polling.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, Pause } from "lucide-react";
import { toast } from "sonner";
import { RUN_STATUS_LABEL, stepLabel } from "@/lib/autopilot-steps";

interface RunRow {
  id: string;
  status: string;
  current_step: string | null;
  current_step_label: string | null;
  current_action_message: string | null;
  progress_percent: number;
  updated_at: string;
  started_at: string;
  pause_requested: boolean;
  admin_needed_reason: string | null;
}

const ACTIVE = ["starting", "running", "auto_fixing"];

export function LiveAutopilotCard() {
  const [run, setRun] = useState<RunRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pausing, setPausing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchActive() {
      const { data } = await supabase
        .from("autopilot_pipeline_runs")
        .select("id,status,current_step,current_step_label,current_action_message,progress_percent,updated_at,started_at,pause_requested,admin_needed_reason")
        .in("status", ACTIVE)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setRun((data as RunRow | null) ?? null);
    }
    fetchActive();
    const poll = setInterval(fetchActive, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const channel = supabase
      .channel("autopilot-live-card")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "autopilot_pipeline_runs" },
        () => fetchActive(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, []);

  if (!run) return null;

  const updatedAgo = Math.max(0, Math.floor((now - new Date(run.updated_at).getTime()) / 1000));
  const stepText = run.current_step_label ?? stepLabel(run.current_step);
  const action = run.current_action_message ?? "Working…";

  async function pauseAfterStep() {
    if (!run) return;
    setPausing(true);
    try {
      const { error } = await supabase
        .from("autopilot_pipeline_runs")
        .update({ pause_requested: true })
        .eq("id", run.id);
      if (error) throw error;
      toast.success("Will pause after the current step finishes");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to pause");
    } finally {
      setPausing(false);
    }
  }

  return (
    <Card className="border-2 border-sky-700 bg-sky-50/40">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Activity className="size-5 text-sky-700 animate-pulse" />
          <h2 className="font-display text-lg uppercase tracking-wide">
            Autopilot {RUN_STATUS_LABEL[run.status] ?? run.status}
          </h2>
          <span className="ml-auto text-xs font-mono text-muted-foreground">
            Last updated: {updatedAgo}s ago
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-sm">
              <span className="text-muted-foreground">Current step: </span>
              <span className="font-medium">{stepText}</span>
            </span>
            <span className="font-mono text-xs">{run.progress_percent}%</span>
          </div>
          <div className="h-2 bg-muted border border-foreground/10 overflow-hidden">
            <div className="h-full bg-sky-600 transition-all" style={{ width: `${Math.max(2, run.progress_percent)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{action}</p>
        </div>

        <div className="flex gap-2 flex-wrap pt-1">
          <Link to={`/admin/autopilot/run/${run.id}`}>
            <Button size="sm" variant="default">View Run Details →</Button>
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={pauseAfterStep}
            disabled={pausing || run.pause_requested}
          >
            {pausing ? <Loader2 className="size-3 animate-spin mr-1" /> : <Pause className="size-3 mr-1" />}
            {run.pause_requested ? "Pause requested…" : "Pause After Current Step"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
