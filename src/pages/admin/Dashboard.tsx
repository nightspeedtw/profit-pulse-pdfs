// Command Center — the only top-level dashboard.
// Strict UX: ONE autopilot toggle, ONE "Generate 1 Ebook Now" button,
// a status strip, six KPI tiles, recent jobs list. Nothing else.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Pause, Sparkles, AlertTriangle, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge, resolveEbookBadge } from "@/components/admin/StatusBadge";
import { AutoFixChip } from "@/components/admin/AutoFixChip";

type Ebook = {
  id: string; title: string;
  autopilot_state: string | null;
  shopify_status: string | null;
  manuscript_qc_status: string | null;
  pdf_status: string | null;
  final_quality_score: number | null;
  updated_at: string;
  qc_status: string | null;
  failed_gate: string | null;
  failed_score: number | null;
  required_score: number | null;
  auto_fix_attempt_count: number | null;
  max_auto_fix_attempts: number | null;
  last_auto_fix_action: string | null;
};

type Settings = {
  paused: boolean;
  autopilot_mode: string;
  daily_quota: number;
  daily_budget_usd: number;
  cost_limit_reached: boolean;
  cost_limit_reason: string | null;
};

type Stats = {
  producedToday: number;
  draftsUploaded: number;
  needsAttention: number;
  failedToday: number;
  costToday: number;
};

export default function CommandCenter() {
  const [ebooks, setEbooks] = useState<Ebook[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats>({
    producedToday: 0, draftsUploaded: 0, needsAttention: 0, failedToday: 0, costToday: 0,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [
      { data: e },
      { data: s },
      { count: producedToday },
      { count: draftsUploaded },
      { count: needsAttention },
      { data: costs },
      { count: failedToday },
    ] = await Promise.all([
      supabase.from("ebooks")
        .select("id,title,autopilot_state,shopify_status,manuscript_qc_status,pdf_status,final_quality_score,updated_at,qc_status,failed_gate,failed_score,required_score,auto_fix_attempt_count,max_auto_fix_attempts,last_auto_fix_action")
        .order("updated_at", { ascending: false }).limit(8),
      supabase.from("generation_settings")
        .select("paused, autopilot_mode, daily_quota, daily_budget_usd, cost_limit_reached, cost_limit_reason")
        .eq("id", 1).maybeSingle(),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .gte("created_at", since.toISOString()),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .eq("shopify_status", "draft"),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .in("autopilot_state", ["needs_review", "awaiting_cover_approval", "awaiting_pdf_approval"]),
      supabase.from("cost_log").select("cost_usd").gte("created_at", since.toISOString()),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .in("autopilot_state", ["failed", "rejected"]),
    ]);
    setEbooks((e ?? []) as Ebook[]);
    setSettings(s as Settings | null);
    setStats({
      producedToday: producedToday ?? 0,
      draftsUploaded: draftsUploaded ?? 0,
      needsAttention: needsAttention ?? 0,
      failedToday: failedToday ?? 0,
      costToday: (costs ?? []).reduce((acc, r) => acc + Number(r.cost_usd ?? 0), 0),
    });
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function togglePause() {
    if (!settings) return;
    const next = !settings.paused;
    const { error } = await supabase.from("generation_settings").update({
      paused: next,
      ...(next ? {} : { cost_limit_reached: false, cost_limit_reason: null }),
    }).eq("id", 1);
    if (error) toast.error(error.message);
    else { toast.success(next ? "Autopilot paused" : "Autopilot resumed"); load(); }
  }

  async function generateOneNow() {
    if (settings?.paused) {
      toast.error("Autopilot is paused — resume first.");
      return;
    }
    setBusy("gen-one");
    try {
      const { data, error } = await supabase.functions.invoke("autopilot-pipeline", {
        body: { mode: settings?.autopilot_mode ?? "safe" },
      });
      if (error || (data as { error?: string } | null)?.error) {
        throw new Error(error?.message ?? (data as { error?: string }).error);
      }
      toast.success("Started 1 ebook");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const costPct = settings
    ? Math.min(100, (stats.costToday / Math.max(0.01, Number(settings.daily_budget_usd))) * 100)
    : 0;
  const quotaPct = settings
    ? Math.min(100, (stats.producedToday / Math.max(1, settings.daily_quota)) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header — 2 primary buttons, exactly as specified */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">[ Command Center ]</p>
          <h1 className="font-display text-4xl uppercase">Ebook Factory</h1>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={togglePause}
            variant={settings?.paused ? "default" : "outline"}
            disabled={!settings}
          >
            {settings?.paused ? <Play className="size-4 mr-1" /> : <Pause className="size-4 mr-1" />}
            {settings?.paused ? "Start Autopilot" : "Pause Autopilot"}
          </Button>
          <Button onClick={generateOneNow} disabled={busy === "gen-one" || settings?.paused}>
            {busy === "gen-one"
              ? <Loader2 className="size-4 animate-spin mr-1" />
              : <Sparkles className="size-4 mr-1" />}
            Generate 1 Ebook Now
          </Button>
        </div>
      </div>

      {/* Autopilot status strip */}
      <Card className="border-2 border-foreground">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge kind={settings?.paused || settings?.cost_limit_reached ? "paused" : "ready"} />
            <span className="font-mono text-xs uppercase text-muted-foreground">Mode:</span>
            <span className="font-mono text-xs uppercase">{settings?.autopilot_mode ?? "safe"}</span>
            {settings?.cost_limit_reached && (
              <span className="text-xs text-red-700 font-bold flex items-center gap-1">
                <DollarSign className="size-3" /> Cost limit reached
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Meter
              label={`Today's production (${stats.producedToday} / ${settings?.daily_quota ?? 0})`}
              pct={quotaPct} tone="emerald"
            />
            <Meter
              label={`Daily cost ($${stats.costToday.toFixed(3)} / $${Number(settings?.daily_budget_usd ?? 0).toFixed(2)})`}
              pct={costPct} tone={costPct >= 90 ? "red" : "sky"}
            />
          </div>
          {settings?.cost_limit_reason && (
            <p className="text-xs text-muted-foreground">{settings.cost_limit_reason}</p>
          )}
        </CardContent>
      </Card>

      {/* KPI tiles — exactly the ones the spec lists */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Produced today" value={stats.producedToday} />
        <Kpi label="Daily quota" value={settings?.daily_quota ?? 0} />
        <Kpi label="Daily AI cost" value={`$${stats.costToday.toFixed(3)}`} />
        <Kpi label="Drafts uploaded" value={stats.draftsUploaded} tone="text-violet-700" />
        <Kpi label="Needs attention" value={stats.needsAttention} tone={stats.needsAttention > 0 ? "text-orange-700" : ""} />
        <Kpi label="Failed jobs" value={stats.failedToday} tone={stats.failedToday > 0 ? "text-red-700" : ""} />
      </div>

      {stats.needsAttention > 0 && (
        <div className="border-2 border-orange-700 bg-orange-50/40 p-3 flex items-center gap-3">
          <AlertTriangle className="size-5 text-orange-700" />
          <span className="text-sm">
            <strong>{stats.needsAttention}</strong> job{stats.needsAttention > 1 ? "s" : ""} need a human decision.
          </span>
          <Link to="/admin/production?filter=needs_attention" className="ml-auto">
            <Button size="sm" variant="outline">Open Production →</Button>
          </Link>
        </div>
      )}

      {/* Recent jobs (compact) */}
      <Card className="border-2 border-foreground">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-mono uppercase">Recent jobs</CardTitle>
          <Link to="/admin/production">
            <Button variant="ghost" size="sm">View all →</Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {ebooks.length === 0 && (
                <tr><td className="p-6 text-center text-muted-foreground text-sm">No jobs yet. Press <strong>Generate 1 Ebook Now</strong> to start.</td></tr>
              )}
              {ebooks.map((e) => {
                const badge = resolveEbookBadge(e);
                return (
                  <tr key={e.id} className="border-t border-foreground/10 hover:bg-muted/30">
                    <td className="p-3">
                      <Link to={`/admin/ebook/${e.id}`} className="font-medium hover:underline line-clamp-1">
                        {e.title || "Untitled"}
                      </Link>
                    </td>
                    <td className="p-3 w-32"><StatusBadge kind={badge} /></td>
                    <td className="p-3 w-24 text-right font-mono text-xs">
                      {e.final_quality_score != null ? `QC ${e.final_quality_score}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card className="border-2 border-foreground">
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide">{label}</CardTitle>
      </CardHeader>
      <CardContent><div className={`font-display text-3xl leading-none ${tone ?? ""}`}>{value}</div></CardContent>
    </Card>
  );
}

function Meter({ label, pct, tone }: { label: string; pct: number; tone: "emerald" | "sky" | "red" }) {
  const bar = tone === "emerald" ? "bg-emerald-600" : tone === "red" ? "bg-red-600" : "bg-sky-600";
  return (
    <div>
      <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide mb-1">{label}</p>
      <div className="h-2 bg-muted border border-foreground/10 overflow-hidden">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}
