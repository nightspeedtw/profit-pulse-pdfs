import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Palette, Play, Save, Pause, PlayCircle, Cog, XCircle, X } from "lucide-react";

interface ColoringConfig {
  enabled: boolean;
  paused: boolean;
  topic_mode: "random" | "specific";
  specific_category_key: string | null;
  age_band: "3-5" | "4-6" | "6-8";
  page_count: 4 | 16 | 24 | 32 | 48;
  batch_size: number;
  daily_cap: number;
  daily_stop_utc: string;
  max_parallel: number;
  daily_cost_cap_usd_coloring: number;
}

interface Category {
  category_key: string;
  category_name: string;
}

const DEFAULTS: ColoringConfig = {
  enabled: false,
  paused: false,
  topic_mode: "random",
  specific_category_key: null,
  age_band: "4-6",
  page_count: 32,
  batch_size: 1,
  daily_cap: 3,
  daily_stop_utc: "22:00",
  max_parallel: 1,
  daily_cost_cap_usd_coloring: 5,
};

interface RecentRow {
  id: string;
  title: string;
  pipeline_status: string;
  listing_status: string | null;
  created_at: string;
  angle: string | null;
  variant_number: number | null;
  progress_percent: number;
  current_step_label: string | null;
  awaiting: string | null;
}

interface ColoringStatus {
  queued: number;
  generating: number;
  cancelled: number;
  published_today: number;
  created_today: number;
  paused: boolean;
  engine_awaiting_p0?: boolean;
  last_worker_tick_at: string | null;
  last_worker_tick_result: unknown;
  recent: RecentRow[];
}

export function ColoringAutopilotCard() {
  const [cfg, setCfg] = useState<ColoringConfig>(DEFAULTS);
  const [cats, setCats] = useState<Category[]>([]);
  const [status, setStatus] = useState<ColoringStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const passcode = () =>
    typeof window !== "undefined" && localStorage.getItem("admin_passcode_ok") === "1" ? "453451" : "";

  const loadStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("coloring-autopilot-config", {
        body: { passcode: passcode() },
        headers: { "x-admin-passcode": passcode() },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setCfg({ ...DEFAULTS, ...(data?.config ?? {}) });
      setCats(data?.categories ?? []);
      setStatus(data?.status ?? null);
    } catch (e) {
      toast({ title: "Failed to load coloring autopilot config", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const hasActive = !!(status?.generating || status?.queued);
  useEffect(() => {
    setLoading(true);
    loadStatus();
    const t = setInterval(loadStatus, hasActive ? 10000 : 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive]);

  const save = async (next: ColoringConfig) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("coloring-autopilot-config", {
        body: { config: next, passcode: passcode() },
        headers: { "x-admin-passcode": passcode() },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setCfg({ ...DEFAULTS, ...(data?.config ?? next) });
      toast({ title: "Coloring autopilot saved" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("coloring-autopilot-tick", {
        body: { manual: true, override_batch: cfg.batch_size, passcode: passcode() },
        headers: { "x-admin-passcode": passcode() },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const queued = (data?.queued ?? []) as Array<{ ok: boolean; title: string; ebook_id?: string; error?: string }>;
      const ok = queued.filter((q) => q.ok).length;
      toast({
        title: `Queued ${ok}/${queued.length} coloring book${queued.length === 1 ? "" : "s"}`,
        description: data?.skipped ? `Skipped: ${data.skipped}` : queued.map((q) => q.title).join(" · ").slice(0, 200),
      });
      await loadStatus();
    } catch (e) {
      toast({ title: "Run failed", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const processQueue = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("coloring-worker-tick", {
        body: { manual: true, passcode: passcode() },
        headers: { "x-admin-passcode": passcode() },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({
        title: data?.skipped ? `Worker skipped: ${data.skipped}` : `Dispatched ${(data?.dispatched ?? []).length} / queue ${data?.queue_size ?? 0}`,
      });
      await loadStatus();
    } catch (e) {
      toast({ title: "Process queue failed", description: String(e), variant: "destructive" });
    }
  };

  const togglePause = async () => {
    await save({ ...cfg, paused: !cfg.paused });
    await loadStatus();
  };

  const cancelAll = async () => {
    if (!confirm("Cancel ALL queued coloring books?")) return;
    try {
      const { data, error } = await supabase.functions.invoke("coloring-cancel-queued", {
        body: { all: true, passcode: passcode() },
        headers: { "x-admin-passcode": passcode() },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({ title: `Cancelled ${data?.cancelled ?? 0} queued coloring book${(data?.cancelled ?? 0) === 1 ? "" : "s"}` });
      await loadStatus();
    } catch (e) {
      toast({ title: "Cancel failed", description: String(e), variant: "destructive" });
    }
  };

  const cancelOne = async (ebook_id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("coloring-cancel-queued", {
        body: { ebook_id, passcode: passcode() },
        headers: { "x-admin-passcode": passcode() },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({ title: (data?.cancelled ?? 0) ? "Cancelled" : "Row not queued (skipped)" });
      await loadStatus();
    } catch (e) {
      toast({ title: "Cancel failed", description: String(e), variant: "destructive" });
    }
  };

  const update = <K extends keyof ColoringConfig>(k: K, v: ColoringConfig[K]) => setCfg((p) => ({ ...p, [k]: v }));

  return (
    <Card className="p-4 border-2 border-foreground">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Palette className="size-5" />
          <h2 className="font-display uppercase text-lg">Coloring Book Autopilot</h2>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="cb-enabled" className="text-xs uppercase font-mono">Auto-schedule</Label>
          <Switch id="cb-enabled" checked={cfg.enabled} onCheckedChange={(v) => update("enabled", v)} disabled={loading} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Independent engine + queue for coloring books — not shared with the picture-book autopilot pause/cost cap. Rows are created immediately; generation begins after the P0 sequential-safe lock releases. Manual "Run now" ignores the daily cap and stop time.
      </p>

      {status && (
        <div className="mb-4 rounded border border-foreground/20 bg-muted/30 p-3 space-y-2">
          {status.engine_awaiting_p0 && !status.paused && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs">
              <b className="text-amber-700">Render engine offline (awaiting P0 close).</b>{" "}
              Rows are being queued with unique English topics + angles, but no page/PDF generation runs yet.
              Progress stays at 10% until the post-P0 coloring render engine ships.
            </div>
          )}
          <div className="flex flex-wrap gap-6 text-sm font-mono">
            <div>
              <span className="text-muted-foreground uppercase text-xs">Engine: </span>
              <b className={status.paused ? "text-amber-600" : status.engine_awaiting_p0 ? "text-amber-600" : "text-emerald-600"}>
                {status.paused ? "paused" : status.engine_awaiting_p0 ? "awaiting P0" : "running"}
              </b>
            </div>
            <div><span className="text-muted-foreground uppercase text-xs">Queued: </span><b>{status.queued}</b></div>
            <div><span className="text-muted-foreground uppercase text-xs">Generating: </span><b>{status.generating}</b></div>
            <div><span className="text-muted-foreground uppercase text-xs">Cancelled: </span><b>{status.cancelled}</b></div>
            <div><span className="text-muted-foreground uppercase text-xs">Created today: </span><b>{status.created_today}</b></div>
            <div><span className="text-muted-foreground uppercase text-xs">Published today: </span><b>{status.published_today}</b></div>
            <div><span className="text-muted-foreground uppercase text-xs">Cap: </span><b>{cfg.daily_cap}/day · {cfg.max_parallel} parallel</b></div>
          </div>
          <div className="text-xs text-muted-foreground">
            Last worker tick: {status.last_worker_tick_at ? new Date(status.last_worker_tick_at).toLocaleString() : "never"}
          </div>
          {status.recent.length > 0 && (
            <ul className="space-y-2 text-xs pt-2 border-t border-foreground/10">
              {status.recent.map((r) => {
                const isLive = r.listing_status === "live";
                const stateLabel = isLive ? "live" : r.pipeline_status;
                const pct = Math.max(0, Math.min(100, Number(r.progress_percent) || 0));
                const barColor = r.pipeline_status === "cancelled"
                  ? "bg-red-500"
                  : isLive
                    ? "bg-emerald-500"
                    : r.pipeline_status === "generating"
                      ? "bg-blue-500"
                      : "bg-amber-500";
                return (
                  <li key={r.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {r.angle && (
                          <span className="px-1.5 py-0.5 rounded bg-foreground/10 text-foreground text-[10px] uppercase font-mono shrink-0">
                            {r.angle}{r.variant_number && r.variant_number > 1 ? ` V${r.variant_number}` : ""}
                          </span>
                        )}
                        <span className="truncate">{r.title}</span>
                      </div>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">{stateLabel}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{pct}%</span>
                        {(r.pipeline_status === "queued" || r.pipeline_status === "generating") && (
                          <button
                            onClick={() => cancelOne(r.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Cancel this book"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded bg-foreground/10 overflow-hidden">
                      <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    {r.current_step_label && (
                      <div className="text-[11px] text-muted-foreground italic pl-1">
                        {r.current_step_label}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Button size="sm" variant={cfg.paused ? "default" : "outline"} onClick={togglePause} disabled={loading || saving}>
          {cfg.paused ? <><PlayCircle className="size-4" /> Resume engine</> : <><Pause className="size-4" /> Pause engine</>}
        </Button>
        <Button size="sm" variant="outline" onClick={processQueue} disabled={loading}>
          <Cog className="size-4" /> Process queue now
        </Button>
        <Button size="sm" variant="outline" onClick={cancelAll} disabled={loading || !status?.queued}>
          <XCircle className="size-4" /> Cancel all queued
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs uppercase font-mono">Topic mode</Label>
          <Select value={cfg.topic_mode} onValueChange={(v) => update("topic_mode", v as ColoringConfig["topic_mode"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="random">Random (weighted)</SelectItem>
              <SelectItem value="specific">Specific category</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {cfg.topic_mode === "specific" && (
          <div>
            <Label className="text-xs uppercase font-mono">Category</Label>
            <Select
              value={cfg.specific_category_key ?? ""}
              onValueChange={(v) => update("specific_category_key", v)}
            >
              <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                {cats.map((c) => (
                  <SelectItem key={c.category_key} value={c.category_key}>{c.category_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label className="text-xs uppercase font-mono">Age band</Label>
          <Select value={cfg.age_band} onValueChange={(v) => update("age_band", v as ColoringConfig["age_band"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3-5">3–5</SelectItem>
              <SelectItem value="4-6">4–6</SelectItem>
              <SelectItem value="6-8">6–8</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Page count</Label>
          <Select value={String(cfg.page_count)} onValueChange={(v) => update("page_count", Number(v) as ColoringConfig["page_count"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4 (test)</SelectItem>
              <SelectItem value="16">16 pages</SelectItem>
              <SelectItem value="24">24 pages</SelectItem>
              <SelectItem value="32">32 pages</SelectItem>
              <SelectItem value="48">48 pages</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Batch size (per run)</Label>
          <Input
            type="number" min={1} max={20} value={cfg.batch_size}
            onChange={(e) => update("batch_size", Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Daily cap (books/day)</Label>
          <Input
            type="number" min={0} max={100} value={cfg.daily_cap}
            onChange={(e) => update("daily_cap", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
        </div>

        <div>
          <Label className="text-xs uppercase font-mono">Daily stop time (UTC)</Label>
          <Input
            type="time" value={cfg.daily_stop_utc}
            onChange={(e) => update("daily_stop_utc", e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 mt-4 flex-wrap">
        <Button onClick={() => save(cfg)} disabled={saving || loading} variant="outline">
          <Save className={`size-4 ${saving ? "animate-pulse" : ""}`} /> Save settings
        </Button>
        <Button onClick={runNow} disabled={running || loading} variant="secondary">
          <Play className={`size-4 ${running ? "animate-pulse" : ""}`} /> Run now ({cfg.batch_size} book{cfg.batch_size === 1 ? "" : "s"})
        </Button>
      </div>
    </Card>
  );
}
