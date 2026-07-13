import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Play, Sparkles, Zap } from "lucide-react";
import { listAgeGroups, listThemes, type KidsAgeGroup, type KidsTheme } from "@/lib/kidsTaxonomy";
import { BuildKidsBookButton } from "@/components/admin/BuildKidsBookButton";

interface ParentJob {
  status?: string;
  final_reason?: string;
  concept_batch_count?: number;
  attempt_count?: number;
  child_attempts?: Array<{ outcome?: string; lane?: string }>;
  published_ebook_id?: string;
}

interface KidsRun {
  id: string;
  status: string;
  current_step_label: string | null;
  progress_percent: number | null;
  blocker_reason: string | null;
  ebook_kids_id: string | null;
  created_at: string;
  metadata: { parent_job?: ParentJob; parent_run_id?: string } | null;
}

interface Weight {
  id: string;
  age_group_id: string;
  theme_id: string;
  weight: number;
  sales_last_30d: number;
  auto_managed: boolean;
}

const PARENT_FRIENDLY: Record<string, { label: string; tone: "info" | "success" | "warn" | "error" }> = {
  searching_for_concept: { label: "Searching for a strong concept", tone: "info" },
  writing_story: { label: "Writing story", tone: "info" },
  repairing_story: { label: "Story repair in progress", tone: "info" },
  building_assets: { label: "Building cover and illustrations", tone: "info" },
  running_qc: { label: "Running final QC", tone: "info" },
  published: { label: "Published", tone: "success" },
  exhausted: { label: "Stopped: quality budget exhausted", tone: "warn" },
  failed_system_error: { label: "System error: needs admin attention", tone: "error" },
};

export default function KidsAutopilot() {
  const [ages, setAges] = useState<KidsAgeGroup[]>([]);
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const [runs, setRuns] = useState<KidsRun[]>([]);
  const [forcing, setForcing] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<"unknown" | "signed_out" | "not_admin" | "admin">("unknown");

  const load = useCallback(async () => {
    setLoadingRuns(true);
    setLoadError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        setAuthState("signed_out");
        setRuns([]);
        return;
      }
      const { data: roleRow, error: roleErr } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (roleErr) {
        console.error("user_roles check failed", roleErr);
      }
      if (!roleRow) {
        setAuthState("not_admin");
        setRuns([]);
        return;
      }
      setAuthState("admin");

      const [a, t, w, r] = await Promise.all([
        listAgeGroups(),
        listThemes(),
        supabase.from("kids_category_weights").select("*"),
        supabase
          .from("autopilot_kids_runs")
          .select("id, status, current_step_label, progress_percent, blocker_reason, ebook_kids_id, created_at, metadata")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      if (r.error) throw r.error;
      setAges(a); setThemes(t);
      setWeights((w.data ?? []) as Weight[]);
      // Hide child runs spawned by a parent job — they surface inside the parent row.
      const rows = ((r.data ?? []) as KidsRun[]).filter(row => !row.metadata?.parent_run_id);
      setRuns(rows);
    } catch (e) {
      console.error("KidsAutopilot load failed", e);
      setLoadError(String((e as Error)?.message ?? e));
    } finally {
      setLoadingRuns(false);
    }
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

  // "Next repair tick" — never force publishes; runs the supervisor once.
  const runRepairTick = async (runId: string, ebookId: string | null) => {
    setForcing(runId);
    try {
      const { data, error } = await supabase.functions.invoke("kids-repair-supervisor", {
        body: { run_id: runId, ebook_id: ebookId },
      });
      if (error) throw error;
      toast({ title: "Next repair tick queued", description: JSON.stringify(data).slice(0, 200) });
      await load();
    } catch (e) {
      toast({ title: "Repair tick failed", description: String(e), variant: "destructive" });
    } finally { setForcing(null); }
  };


  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl uppercase flex items-center gap-2"><Sparkles className="size-6" /> Kids Autopilot</h1>
          <p className="text-sm text-muted-foreground">Weighted-by-demand picker. Higher weight or recent sales = more likely to be generated next.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <BuildKidsBookButton onStarted={load} />
          <Button onClick={recompute} disabled={busy} variant="outline">
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Recompute from sales
          </Button>
          <Button onClick={runNow} disabled={running} variant="secondary">
            <Play className={`size-4 ${running ? "animate-pulse" : ""}`} /> Weighted auto-pick
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
        {loadingRuns ? (
          <p className="text-sm text-muted-foreground">Loading recent runs…</p>
        ) : authState === "signed_out" ? (
          <p className="text-sm text-muted-foreground">
            Sign in as an admin to see recent runs.{" "}
            <a href="/auth" className="underline">Sign in</a>
          </p>
        ) : authState === "not_admin" ? (
          <p className="text-sm text-muted-foreground">
            This account isn't an admin — recent runs are admin-only.
          </p>
        ) : loadError ? (
          <p className="text-sm text-red-600">Failed to load runs: {loadError}</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>

        ) : (
          <div className="space-y-2">
            {runs.map((r) => {
              const parent = r.metadata?.parent_job;
              const parentStatus = parent?.status;
              const friendly = parentStatus ? PARENT_FRIENDLY[parentStatus] : null;
              const showLabel = friendly?.label ?? r.current_step_label ?? "—";
              const badgeText = friendly ? friendly.label.split(":")[0] : r.status;
              const badgeClass = friendly
                ? friendly.tone === "success" ? "bg-green-500/20 text-green-700"
                : friendly.tone === "warn" ? "bg-yellow-500/20 text-yellow-700"
                : friendly.tone === "error" ? "bg-red-500/20 text-red-700"
                : "bg-muted"
                : r.status === "completed" ? "bg-green-500/20 text-green-700"
                : r.status === "failed" ? "bg-red-500/20 text-red-700"
                : r.status === "running" ? "bg-yellow-500/20 text-yellow-700"
                : "bg-muted";
              const canRepair = r.status === "failed" || r.status === "running";
              const attempts = parent?.attempt_count ?? 0;
              const batches = parent?.concept_batch_count ?? 0;
              const childCount = parent?.child_attempts?.length ?? 0;
              return (
                <div key={r.id} className="flex items-center gap-3 p-2 border border-foreground/20 rounded text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${badgeClass}`}>{badgeText}</span>
                  <span className="flex-1 truncate">
                    <span className="text-muted-foreground">{showLabel}</span>
                    {parent ? (
                      <>
                        <span className="mx-2">·</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {batches} concept batch{batches === 1 ? "" : "es"} · {attempts} ebook attempt{attempts === 1 ? "" : "s"} · {childCount} internal step{childCount === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="mx-2">·</span>
                        <span className="tabular-nums">{r.progress_percent ?? 0}%</span>
                      </>
                    )}
                    {!parent && r.blocker_reason && (
                      <span className="ml-2 text-red-600 text-xs truncate">⚠ {r.blocker_reason.slice(0, 80)}</span>
                    )}
                    {parent?.final_reason && parentStatus === "exhausted" && (
                      <span className="ml-2 text-yellow-700 text-xs truncate">⚠ {parent.final_reason}</span>
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
                  {canRepair && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runRepairTick(r.id, r.ebook_kids_id)}
                      disabled={forcing === r.id}
                      title="Runs the next safe repair — never force-publishes."
                    >
                      <Zap className={`size-3 ${forcing === r.id ? "animate-pulse" : ""}`} />
                      Next repair
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
