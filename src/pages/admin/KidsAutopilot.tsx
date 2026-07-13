import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Play, Sparkles, Zap } from "lucide-react";
import { listAgeGroups, listThemes, type KidsAgeGroup, type KidsTheme } from "@/lib/kidsTaxonomy";

interface KidsRun {
  id: string;
  status: string;
  current_step_label: string | null;
  progress_percent: number | null;
  blocker_reason: string | null;
  ebook_kids_id: string | null;
  created_at: string;
}

interface Weight {
  id: string;
  age_group_id: string;
  theme_id: string;
  weight: number;
  sales_last_30d: number;
  auto_managed: boolean;
}

export default function KidsAutopilot() {
  const [ages, setAges] = useState<KidsAgeGroup[]>([]);
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const [runs, setRuns] = useState<KidsRun[]>([]);
  const [forcing, setForcing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, t, w, r] = await Promise.all([
      listAgeGroups(),
      listThemes(),
      supabase.from("kids_category_weights").select("*"),
      supabase
        .from("autopilot_kids_runs")
        .select("id, status, current_step_label, progress_percent, blocker_reason, ebook_kids_id, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setAges(a); setThemes(t);
    setWeights((w.data ?? []) as Weight[]);
    setRuns((r.data ?? []) as KidsRun[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cell = (ageId: string, themeId: string) =>
    weights.find((w) => w.age_group_id === ageId && w.theme_id === themeId);

  const setWeight = async (id: string, value: number) => {
    setWeights((prev) => prev.map((w) => (w.id === id ? { ...w, weight: value, auto_managed: false } : w)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("kids_category_weights") as any).update({ weight: value, auto_managed: false }).eq("id", id);
  };

  const toggleAuto = async (id: string, value: boolean) => {
    setWeights((prev) => prev.map((w) => (w.id === id ? { ...w, auto_managed: value } : w)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("kids_category_weights") as any).update({ auto_managed: value }).eq("id", id);
  };

  const recompute = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("kids-recompute-weights", { body: {} });
      if (error) throw error;
      toast({ title: "Weights recomputed", description: `Updated ${(data as { updated: number })?.updated ?? 0} cells from last 30 days of sales.` });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("autopilot-kids-orchestrator", { body: {} });
      if (error) throw error;
      toast({ title: "Kids autopilot ticked", description: JSON.stringify(data).slice(0, 160) });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    } finally { setRunning(false); }
  };

  const forceFinish = async (runId: string) => {
    setForcing(runId);
    try {
      const { data, error } = await supabase.functions.invoke("autopilot-kids-pipeline", {
        body: { run_id: runId, force_finish: true },
      });
      if (error) throw error;
      toast({ title: "Force-finish complete", description: JSON.stringify(data).slice(0, 200) });
      await load();
    } catch (e) {
      toast({ title: "Force-finish failed", description: String(e), variant: "destructive" });
    } finally { setForcing(null); }
  };


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl uppercase flex items-center gap-2"><Sparkles className="size-6" /> Kids Autopilot</h1>
          <p className="text-sm text-muted-foreground">Weighted-by-demand picker. Higher weight or recent sales = more likely to be generated next.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={recompute} disabled={busy} variant="outline">
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Recompute from sales
          </Button>
          <Button onClick={runNow} disabled={running}>
            <Play className={`size-4 ${running ? "animate-pulse" : ""}`} /> Start one book now
          </Button>
        </div>
      </div>

      <Card className="p-4 border-2 border-foreground overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-foreground">
              <th className="text-left p-2 font-mono uppercase text-xs">Age \ Theme</th>
              {themes.map((t) => (
                <th key={t.id} className="text-left p-2 font-mono uppercase text-xs whitespace-nowrap">{t.label_en}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ages.map((a) => (
              <tr key={a.id} className="border-b border-foreground/20">
                <td className="p-2 font-medium whitespace-nowrap">{a.label_en}</td>
                {themes.map((t) => {
                  const c = cell(a.id, t.id);
                  if (!c) return <td key={t.id} className="p-2 text-muted-foreground">—</td>;
                  return (
                    <td key={t.id} className="p-2 min-w-[140px]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={0} max={100} value={c.weight}
                            onChange={(e) => setWeight(c.id, Number(e.target.value))}
                            className="w-16 px-2 py-1 border border-foreground/30 rounded text-right tabular-nums"
                          />
                          <span className="text-[10px] text-muted-foreground">wt</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Switch checked={c.auto_managed} onCheckedChange={(v) => toggleAuto(c.id, v)} />
                          <span>auto</span>
                          <span className="ml-auto">${c.sales_last_30d} sold</span>
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted-foreground">
        Weight = base + sales boost (auto cells refresh when you press Recompute). Set weight to 0 to disable a cell entirely.
      </p>

      <Card className="p-4 border-2 border-foreground">
        <h2 className="font-display text-xl uppercase mb-3 flex items-center gap-2">
          <Zap className="size-5" /> Recent runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((r) => {
              const canForce = r.status === "failed" || r.status === "running";
              return (
                <div key={r.id} className="flex items-center gap-3 p-2 border border-foreground/20 rounded text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${
                    r.status === "completed" ? "bg-green-500/20 text-green-700" :
                    r.status === "failed" ? "bg-red-500/20 text-red-700" :
                    r.status === "running" ? "bg-yellow-500/20 text-yellow-700" :
                    "bg-muted"
                  }`}>{r.status}</span>
                  <span className="flex-1 truncate">
                    <span className="text-muted-foreground">{r.current_step_label ?? "—"}</span>
                    <span className="mx-2">·</span>
                    <span className="tabular-nums">{r.progress_percent ?? 0}%</span>
                    {r.blocker_reason && (
                      <span className="ml-2 text-red-600 text-xs truncate">⚠ {r.blocker_reason.slice(0, 80)}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {r.ebook_kids_id && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/admin/kids/${r.ebook_kids_id}/qc`}>QC report</a>
                    </Button>
                  )}
                  {canForce && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => forceFinish(r.id)}
                      disabled={forcing === r.id}
                    >
                      <Zap className={`size-3 ${forcing === r.id ? "animate-pulse" : ""}`} />
                      Force finish
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

    </div>
  );
}
