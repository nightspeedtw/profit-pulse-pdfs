// ColoringV2AutopilotCard — the ONLY coloring admin panel post-cutover.
// Reads/writes coloring_v2_* tables and dispatches v2 tick + autopilot.
// V1 books are intentionally invisible here (parked to archived_v1).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Palette, Play, RefreshCw, Zap } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface V2Book {
  id: string;
  title: string | null;
  age_band: string;
  stage: string;
  publish_status: string;
  generation_status: string;
  overall_qc_score: number | null;
  stage_attempt_count: number;
  last_error: string | null;
  created_at: string;
}

interface Counters {
  total: number;
  live: number;
  in_flight: number;
  failed: number;
  created_today: number;
  live_by_band: Record<string, number>;
}

export function ColoringV2AutopilotCard() {
  const [books, setBooks] = useState<V2Book[]>([]);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);

  const load = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = supabase;
      const [recent, all, flag] = await Promise.all([
        c.from("coloring_v2_books")
          .select("id,title,age_band,stage,publish_status,generation_status,overall_qc_score,stage_attempt_count,last_error,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        c.from("coloring_v2_books")
          .select("id,age_band,publish_status,stage,created_at"),
        c.from("platform_settings").select("value_json").eq("key", "ENABLE_COLORING_LANE_V2").maybeSingle(),
      ]);
      const rows = (all?.data ?? []) as Array<{ age_band: string; publish_status: string; stage: string; created_at: string }>;
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const cutIso = dayStart.toISOString();
      const liveByBand: Record<string, number> = {};
      let live = 0, inFlight = 0, failed = 0, createdToday = 0;
      for (const r of rows) {
        if (r.publish_status === "live") { live++; liveByBand[r.age_band] = (liveByBand[r.age_band] ?? 0) + 1; }
        else if (r.stage === "failed") failed++;
        else inFlight++;
        if (r.created_at >= cutIso) createdToday++;
      }
      setCounters({ total: rows.length, live, in_flight: inFlight, failed, created_today: createdToday, live_by_band: liveByBand });
      setBooks((recent?.data ?? []) as V2Book[]);
      setFlagEnabled((flag?.data?.value_json?.enabled ?? true) !== false);
    } catch (e) {
      toast({ title: "Load failed", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true); load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const runTick = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("coloring-v2-tick", { body: {} });
      if (error) throw error;
      toast({ title: `V2 tick fired ${(data as { slots?: number })?.slots ?? 0} slot(s)` });
      await load();
    } catch (e) { toast({ title: "Tick failed", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const runAutopilot = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("coloring-v2-autopilot", { body: { manual: true } });
      if (error) throw error;
      const d = data as { planned?: number; skipped?: string };
      toast({ title: d?.skipped ? `Autopilot: ${d.skipped}` : `Autopilot planned ${d?.planned ?? 0} book(s)` });
      await load();
    } catch (e) { toast({ title: "Autopilot failed", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const stageColor = (s: string) => s === "publish" ? "text-emerald-600"
    : s === "failed" ? "text-red-600"
    : "text-blue-600";

  return (
    <Card className="p-4 border-2 border-foreground">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Palette className="size-5" />
          <h2 className="font-display uppercase text-lg">Coloring Autopilot (V2 — only lane)</h2>
          {flagEnabled === false && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 font-mono">V2 FLAG OFF</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={runTick} disabled={busy}>
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Advance tick
          </Button>
          <Button size="sm" onClick={runAutopilot} disabled={busy}>
            <Zap className="size-4" /> Autopilot fresh books
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        V1 lane is shelved (parked to <code>archived_v1</code>, hidden here).
        V2 books flow through <code>coloring_v2_books</code> → <code>coloring-v2-tick</code>
        (safety-net cron every 2 min). Autopilot creates fresh books across age bands toward the daily cap.
      </p>

      {counters && (
        <div className="mb-3 rounded border border-foreground/20 bg-muted/30 p-3 text-sm font-mono flex flex-wrap gap-4">
          <div><span className="text-muted-foreground uppercase text-xs">V2 Total: </span><b>{counters.total}</b></div>
          <div><span className="text-muted-foreground uppercase text-xs">Live: </span><b className="text-emerald-600">{counters.live}</b></div>
          <div><span className="text-muted-foreground uppercase text-xs">In-flight: </span><b>{counters.in_flight}</b></div>
          <div><span className="text-muted-foreground uppercase text-xs">Failed: </span><b className="text-red-600">{counters.failed}</b></div>
          <div><span className="text-muted-foreground uppercase text-xs">Created today: </span><b>{counters.created_today}</b></div>
          <div className="w-full text-xs text-muted-foreground">
            Live by band:&nbsp;
            {["2-4","4-6","6-8","8-12","13-17"].map((b) => (
              <span key={b} className="mr-3">{b}: <b>{counters.live_by_band[b] ?? 0}</b></span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading V2 books…</div>
      ) : books.length === 0 ? (
        <div className="text-sm text-muted-foreground">No V2 books yet. Hit “Autopilot fresh books” to start filling the catalog.</div>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {books.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 border-b border-foreground/5 py-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="px-1.5 py-0.5 rounded bg-foreground/10 text-[10px] uppercase font-mono shrink-0">{b.age_band}</span>
                <span className="truncate">{b.title ?? "(untitled)"}</span>
              </div>
              <span className="flex items-center gap-2 shrink-0 font-mono">
                <span className={stageColor(b.stage)}>{b.publish_status === "live" ? "live" : b.stage}</span>
                {b.overall_qc_score != null && <span className="text-muted-foreground">QC {b.overall_qc_score}</span>}
                {b.stage_attempt_count > 0 && <span className="text-amber-600">att {b.stage_attempt_count}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
