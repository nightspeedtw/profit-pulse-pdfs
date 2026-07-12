import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Activity, Play, Pause, RefreshCw, Zap } from "lucide-react";

interface Settings {
  autopilot_enabled: boolean;
  tick_enabled: boolean;
  paused: boolean;
  cost_limit_reason: string | null;
  max_parallel_books: number;
  max_books_per_day: number;
  daily_cost_cap_usd: number;
  stuck_run_ttl_min: number;
  last_tick_at: string | null;
  last_tick_result: Record<string, unknown> | null;
}

interface Run {
  id: string;
  ebook_id: string | null;
  status: string;
  current_step: string | null;
  current_step_label: string | null;
  progress_percent: number | null;
  started_at: string;
  updated_at: string;
  blocker_reason: string | null;
}

export default function AutopilotControl() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [ticking, setTicking] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [s, r] = await Promise.all([
      supabase.from("generation_settings").select("autopilot_enabled,tick_enabled,paused,cost_limit_reason,max_parallel_books,max_books_per_day,daily_cost_cap_usd,stuck_run_ttl_min,last_tick_at,last_tick_result").eq("id", 1).maybeSingle(),
      supabase.from("autopilot_pipeline_runs").select("id,ebook_id,status,current_step,current_step_label,progress_percent,started_at,updated_at,blocker_reason").order("updated_at", { ascending: false }).limit(20),
    ]);
    if (s.data) setSettings(s.data as unknown as Settings);
    if (r.data) setRuns(r.data as unknown as Run[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    const channel = supabase
      .channel("autopilot-control")
      .on("postgres_changes", { event: "*", schema: "public", table: "autopilot_pipeline_runs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "generation_settings" }, () => load())
      .subscribe();
    return () => { clearInterval(iv); supabase.removeChannel(channel); };
  }, []);

  const update = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from("generation_settings").update(patch).eq("id", 1);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else load();
  };

  const runTick = async () => {
    setTicking(true);
    try {
      const { data, error } = await supabase.functions.invoke("autopilot-tick", { body: {} });
      if (error) throw error;
      toast({ title: "Tick executed", description: `Active: ${(data as any)?.active_runs ?? "?"}, spent: $${(data as any)?.spent_today ?? "?"}` });
      load();
    } catch (e) {
      toast({ title: "Tick failed", description: String(e), variant: "destructive" });
    } finally { setTicking(false); }
  };

  const resume = () => update({ paused: false, cost_limit_reason: null });

  if (loading || !settings) return <div className="p-6">Loading…</div>;

  const last = settings.last_tick_result ?? {};
  const active = runs.filter((r) => ["running", "queued"].includes(r.status));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl uppercase">Autopilot 24/7</h1>
          <p className="text-sm text-muted-foreground">Tick every 5 min. Strict QC — no soft-pass to live.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={runTick} disabled={ticking} variant="outline">
            <RefreshCw className={`size-4 ${ticking ? "animate-spin" : ""}`} /> Run tick now
          </Button>
        </div>
      </div>

      {settings.paused && (
        <Card className="p-4 border-2 border-destructive bg-destructive/10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-bold">Autopilot paused</p>
              <p className="text-sm text-muted-foreground">{settings.cost_limit_reason ?? "Manually paused"}</p>
            </div>
            <Button onClick={resume}><Play className="size-4" /> Resume</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 space-y-3 border-2 border-foreground">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase">Autopilot</span>
            <Switch checked={settings.autopilot_enabled} onCheckedChange={(v) => update({ autopilot_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase">5-min Tick</span>
            <Switch checked={settings.tick_enabled} onCheckedChange={(v) => update({ tick_enabled: v })} />
          </div>
          <p className="text-xs text-muted-foreground">Both must be ON for auto-generation.</p>
        </Card>

        <Card className="p-4 space-y-2 border-2 border-foreground">
          <div className="font-mono text-xs uppercase">Guardrails</div>
          <Row label="Max parallel books" value={settings.max_parallel_books} onChange={(v) => update({ max_parallel_books: v })} min={1} max={5} />
          <Row label="Max books / day" value={settings.max_books_per_day} onChange={(v) => update({ max_books_per_day: v })} min={1} max={30} />
          <Row label="Daily cost cap ($)" value={settings.daily_cost_cap_usd} onChange={(v) => update({ daily_cost_cap_usd: v })} min={1} max={100} step={1} />
          <Row label="Stuck TTL (min)" value={settings.stuck_run_ttl_min} onChange={(v) => update({ stuck_run_ttl_min: v })} min={5} max={60} />
        </Card>

        <Card className="p-4 space-y-2 border-2 border-foreground">
          <div className="font-mono text-xs uppercase flex items-center gap-2"><Activity className="size-3" /> Last tick</div>
          <p className="text-sm">{settings.last_tick_at ? new Date(settings.last_tick_at).toLocaleString() : "never"}</p>
          <div className="text-xs space-y-1">
            <div>Active runs: <b>{(last as any).active_runs ?? "—"}</b></div>
            <div>Started today: <b>{(last as any).started_today ?? "—"}</b></div>
            <div>Spent today: <b>${(last as any).spent_today ?? "—"}</b> / ${(last as any).budget ?? "—"}</div>
            <div>Reaped: <b>{Array.isArray((last as any).reaped) ? (last as any).reaped.length : 0}</b></div>
            <div>Launched: <b>{Array.isArray((last as any).launched) ? (last as any).launched.length : 0}</b></div>
            <div>Published: <b>{Array.isArray((last as any).published) ? (last as any).published.filter((p: any) => p.ok).length : 0}</b></div>
          </div>
        </Card>
      </div>

      <Card className="p-4 border-2 border-foreground">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl uppercase flex items-center gap-2"><Zap className="size-4" /> Pipeline runs</h2>
          <span className="text-sm text-muted-foreground">{active.length} active / {runs.length} recent</span>
        </div>
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 border border-foreground/20 rounded">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="text-sm font-mono truncate">{r.current_step_label || r.current_step || "—"}</span>
                </div>
                {r.blocker_reason && <p className="text-xs text-destructive mt-1">⚠ {r.blocker_reason}</p>}
                <p className="text-xs text-muted-foreground">
                  {r.ebook_id?.slice(0, 8) ?? "—"} · updated {new Date(r.updated_at).toLocaleTimeString()}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-bold tabular-nums">{r.progress_percent ?? 0}%</div>
              </div>
            </div>
          ))}
          {runs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No runs yet. Enable autopilot and wait 5 min, or click "Run tick now".</p>}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs">{label}</span>
      <input type="number" value={value ?? 0} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 px-2 py-1 border border-foreground/30 rounded text-sm text-right" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-700 border-blue-500",
    queued: "bg-amber-500/20 text-amber-700 border-amber-500",
    completed: "bg-green-500/20 text-green-700 border-green-500",
    failed: "bg-red-500/20 text-red-700 border-red-500",
    needs_review: "bg-orange-500/20 text-orange-700 border-orange-500",
    superseded: "bg-muted text-muted-foreground",
  };
  return <Badge variant="outline" className={`text-xs ${map[status] ?? ""}`}>{status}</Badge>;
}
