// Production Command Center — Track 5.
// Controls daily production capacity, category mix, cost cap, QC-throttle,
// and safe autopilot start/pause. Does NOT lower any QC gate.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Play, Pause, Zap, RefreshCw, AlertTriangle, Save, Rocket } from "lucide-react";
import { computeCapacity, type CapacityResult, type CategoryMixEntry } from "@/lib/productionCapacity";
import { STYLE_PROFILES_LITE } from "@/lib/styleProfiles";

type Settings = {
  id: number;
  autopilot_enabled: boolean;
  paused: boolean;
  daily_quota: number;
  daily_budget_usd: number;
  cost_limit_reached: boolean;
  autopilot_mode: string;
  daily_cost_cap_usd: number;
  max_books_per_day: number;
  max_parallel_books: number;
  max_parallel_heavy_jobs: number;
  minimum_qc_pass_rate: number;
  pause_when_cost_limit_reached: boolean;
  pause_when_qc_pass_rate_low: boolean;
  enabled_categories_json: CategoryMixEntry[] | null;
  safe_publish_to_store: boolean;
  quality_first_mode: boolean;
  category_mix: Record<string, number> | null;
};

type Metrics = {
  costUsedToday: number;
  booksStartedToday: number;
  booksCompletedToday: number;
  booksQcReadyToday: number;
  booksPublishedToday: number;
  activeQueueCount: number;
  inProgressCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  eligibleIdeas: number;
  avgCostPerBook: number | null;
  avgMinutesPerBook: number | null;
  qcPassRate: number | null;
  categoryMixToday: Record<string, number>;
  categoryMixWeek: Record<string, number>;
};

export default function ProductionCommandCenter() {
  const [s, setS] = useState<Settings | null>(null);
  const [m, setM] = useState<Metrics | null>(null);
  const [mix, setMix] = useState<CategoryMixEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfWeek = new Date(); startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 7);
    const isoDay = startOfDay.toISOString();
    const isoWeek = startOfWeek.toISOString();

    const [
      { data: setRow },
      { data: costs },
      { data: ebooksToday },
      { data: ebooksWeek },
      { count: activeQueue },
      { count: inProgress },
      { count: needsReview },
      { count: rejected },
      { count: eligibleIdeas },
    ] = await Promise.all([
      supabase.from("generation_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("cost_log").select("cost_usd").gte("created_at", isoDay),
      supabase.from("ebooks").select("id,category_slug,autopilot_state,manuscript_qc_status,listing_status,final_quality_score,created_at,updated_at").gte("created_at", isoDay),
      supabase.from("ebooks").select("id,category_slug,final_quality_score,created_at,updated_at,autopilot_state").gte("created_at", isoWeek),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .in("autopilot_state", ["queued", "running", "writing", "cover", "pdf", "qc"]),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .in("autopilot_state", ["running", "writing", "cover", "pdf"]),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .in("autopilot_state", ["needs_review", "awaiting_cover_approval", "awaiting_pdf_approval"]),
      supabase.from("ebooks").select("id", { count: "exact", head: true })
        .in("autopilot_state", ["failed", "rejected"]),
      supabase.from("ebook_ideas").select("id", { count: "exact", head: true })
        .in("status", ["idea", "approved"]),
    ]);

    const settings = (setRow as unknown as Settings) ?? null;
    const costUsedToday = (costs ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
    const startedToday = ebooksToday?.length ?? 0;
    const completed = (ebooksToday ?? []).filter((e: any) => e.autopilot_state === "completed" || e.listing_status === "listed").length;
    const qcReady = (ebooksToday ?? []).filter((e: any) => (e.final_quality_score ?? 0) >= 80).length;
    const published = (ebooksToday ?? []).filter((e: any) => e.listing_status === "listed").length;

    // Recent averages from last 7 days completed ebooks
    const completedWeek = (ebooksWeek ?? []).filter((e: any) => e.autopilot_state === "completed" || (e.final_quality_score ?? 0) >= 80);
    let avgMinutes: number | null = null;
    if (completedWeek.length > 0) {
      const durations = completedWeek.map((e: any) => {
        const c = new Date(e.created_at).getTime();
        const u = new Date(e.updated_at).getTime();
        return Math.max(1, (u - c) / 60000);
      });
      avgMinutes = durations.reduce((a: number, b: number) => a + b, 0) / durations.length;
    }
    const passed = completedWeek.filter((e: any) => (e.final_quality_score ?? 0) >= 80).length;
    const qcPassRate = ebooksWeek && ebooksWeek.length > 0
      ? (passed / ebooksWeek.length) * 100
      : null;

    // Avg cost per completed ebook — use last 7 days cost / completed count as proxy
    const { data: weekCosts } = await supabase.from("cost_log").select("cost_usd").gte("created_at", isoWeek);
    const weekSpend = (weekCosts ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
    const avgCostPerBook = completedWeek.length > 0 ? weekSpend / completedWeek.length : null;

    const mixToday: Record<string, number> = {};
    (ebooksToday ?? []).forEach((e: any) => {
      const k = e.category_slug ?? "general";
      mixToday[k] = (mixToday[k] ?? 0) + 1;
    });
    const mixWeek: Record<string, number> = {};
    (ebooksWeek ?? []).forEach((e: any) => {
      const k = e.category_slug ?? "general";
      mixWeek[k] = (mixWeek[k] ?? 0) + 1;
    });

    setS(settings);
    setM({
      costUsedToday,
      booksStartedToday: startedToday,
      booksCompletedToday: completed,
      booksQcReadyToday: qcReady,
      booksPublishedToday: published,
      activeQueueCount: activeQueue ?? 0,
      inProgressCount: inProgress ?? 0,
      needsReviewCount: needsReview ?? 0,
      rejectedCount: rejected ?? 0,
      eligibleIdeas: eligibleIdeas ?? 0,
      avgCostPerBook,
      avgMinutesPerBook: avgMinutes,
      qcPassRate,
      categoryMixToday: mixToday,
      categoryMixWeek: mixWeek,
    });

    // Hydrate mix — seed from enabled_categories_json, or from STYLE_PROFILES_LITE
    const stored = (settings?.enabled_categories_json ?? []) as CategoryMixEntry[];
    const seeded: CategoryMixEntry[] = STYLE_PROFILES_LITE.map((p) => {
      const existing = stored.find((x) => x.slug === p.slug);
      return existing ?? { slug: p.slug, weight: 1, enabled: p.slug === "finance" || p.slug === "wellness" || p.slug === "beginner" };
    });
    setMix(seeded);
  }

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  const capacity: CapacityResult | null = useMemo(() => {
    if (!s || !m) return null;
    return computeCapacity({
      dailyCostCapUsd: Number(s.daily_cost_cap_usd),
      costUsedToday: m.costUsedToday,
      maxBooksPerDay: Number(s.max_books_per_day),
      maxParallelBooks: Number(s.max_parallel_books),
      minimumQcPassRate: Number(s.minimum_qc_pass_rate),
      booksStartedToday: m.booksStartedToday,
      recentAvgCostPerBook: m.avgCostPerBook,
      recentAvgMinutesPerBook: m.avgMinutesPerBook,
      recentQcPassRate: m.qcPassRate,
      activeQueueCount: m.activeQueueCount,
      inProgressCount: m.inProgressCount,
      eligibleIdeas: m.eligibleIdeas,
      paused: s.paused,
      autopilotEnabled: s.autopilot_enabled,
      costLimitReached: s.cost_limit_reached,
      enabledCategoryCount: mix.filter((x) => x.enabled).length,
    });
  }, [s, m, mix]);

  async function patchSettings(patch: Partial<Settings>) {
    if (!s) return;
    setSaving(true);
    const { error } = await supabase.from("generation_settings").update(patch as any).eq("id", 1);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setS({ ...s, ...patch });
    toast.success("Saved");
  }

  async function saveMix() {
    await patchSettings({ enabled_categories_json: mix });
  }

  async function pause() { await patchSettings({ paused: true }); }
  async function resume() { await patchSettings({ paused: false, autopilot_enabled: true }); }

  async function startRecommendedBatch() {
    if (!capacity || capacity.recommendedStartsToday <= 0) {
      toast.error("No recommended starts right now."); return;
    }
    setBusy("batch");
    try {
      const { error } = await supabase.functions.invoke("daily-cron", { body: { source: "command_center", limit: capacity.recommendedStartsToday } });
      if (error) throw error;
      toast.success(`Started up to ${capacity.recommendedStartsToday} ebooks.`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function startOneNow() {
    setBusy("one");
    try {
      const { data: ideas } = await supabase.from("ebook_ideas")
        .select("id").in("status", ["idea", "approved"]).order("total_score", { ascending: false }).limit(1);
      const idea = ideas?.[0];
      if (!idea) throw new Error("No eligible idea in the pool");
      const { error } = await supabase.functions.invoke("autopilot-pipeline", { body: { idea_id: idea.id, mode: "full" } });
      if (error) throw error;
      toast.success("Started 1 premium ebook.");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  if (!s || !m || !capacity) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading command center…</div>;
  }

  const stateLabel: Record<CapacityResult["autopilotState"], { label: string; tone: string }> = {
    running: { label: "Running", tone: "bg-green-100 text-green-800" },
    paused: { label: "Paused", tone: "bg-yellow-100 text-yellow-800" },
    cost_limited: { label: "Cost Limited", tone: "bg-orange-100 text-orange-800" },
    qc_limited: { label: "QC Limited", tone: "bg-red-100 text-red-800" },
    needs_admin_attention: { label: "Needs Admin", tone: "bg-red-100 text-red-800" },
    disabled: { label: "Disabled", tone: "bg-gray-200 text-gray-700" },
    no_categories: { label: "No Categories", tone: "bg-orange-100 text-orange-800" },
  };
  const st = stateLabel[capacity.autopilotState];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl uppercase">Production Command Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Daily premium PDF production — capacity, quality, cost. Never lowers QC gates.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={st.tone}>{st.label}</Badge>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" /> Recalculate</Button>
          {s.paused
            ? <Button size="sm" onClick={resume}><Play className="size-4" /> Resume</Button>
            : <Button size="sm" variant="outline" onClick={pause}><Pause className="size-4" /> Pause</Button>}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Daily target" value={s.max_books_per_day} />
        <Kpi label="Recommended starts today" value={capacity.recommendedStartsToday} accent={capacity.recommendedStartsToday > 0 ? "text-green-700" : "text-orange-700"} />
        <Kpi label="Books started today" value={m.booksStartedToday} />
        <Kpi label="Books completed today" value={m.booksCompletedToday} />
        <Kpi label="QC-ready today" value={m.booksQcReadyToday} />
        <Kpi label="Published to Store today" value={m.booksPublishedToday} />
        <Kpi label="Active queue" value={m.activeQueueCount} />
        <Kpi label="In progress" value={m.inProgressCount} />
        <Kpi label="Needs review" value={m.needsReviewCount} accent={m.needsReviewCount > 0 ? "text-orange-700" : ""} />
        <Kpi label="Rejected" value={m.rejectedCount} />
        <Kpi label="Cost used today" value={`$${m.costUsedToday.toFixed(3)}`} />
        <Kpi label="Cost remaining" value={`$${Math.max(0, s.daily_cost_cap_usd - m.costUsedToday).toFixed(3)}`} />
        <Kpi label="Avg cost / ebook" value={m.avgCostPerBook != null ? `$${m.avgCostPerBook.toFixed(3)}` : "—"} />
        <Kpi label="Avg time / ebook" value={m.avgMinutesPerBook != null ? `${m.avgMinutesPerBook.toFixed(0)}m` : "—"} />
        <Kpi label="Recent QC pass rate" value={m.qcPassRate != null ? `${m.qcPassRate.toFixed(0)}%` : "—"} accent={m.qcPassRate != null && m.qcPassRate < 70 ? "text-red-700" : ""} />
        <Kpi label="Eligible ideas" value={m.eligibleIdeas} />
      </div>

      {capacity.warnings.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            {capacity.warnings.map((w) => (
              <div key={w} className="flex items-start gap-2 text-sm text-orange-800">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {w}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">Daily limits</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Daily cost cap (USD)"><Input type="number" step="0.5" value={s.daily_cost_cap_usd} onChange={(e) => setS({ ...s, daily_cost_cap_usd: Number(e.target.value) })} /></Field>
            <Field label="Max books per day"><Input type="number" value={s.max_books_per_day} onChange={(e) => setS({ ...s, max_books_per_day: Number(e.target.value) })} /></Field>
            <Field label="Max parallel books"><Input type="number" value={s.max_parallel_books} onChange={(e) => setS({ ...s, max_parallel_books: Number(e.target.value) })} /></Field>
            <Field label="Max parallel heavy jobs (cover/PDF)"><Input type="number" value={s.max_parallel_heavy_jobs} onChange={(e) => setS({ ...s, max_parallel_heavy_jobs: Number(e.target.value) })} /></Field>
            <Field label="Minimum acceptable QC pass rate (%)"><Input type="number" value={s.minimum_qc_pass_rate} onChange={(e) => setS({ ...s, minimum_qc_pass_rate: Number(e.target.value) })} /></Field>
            <div className="flex items-center justify-between text-sm"><span>Auto-pause on cost limit</span><Switch checked={s.pause_when_cost_limit_reached} onCheckedChange={(v) => setS({ ...s, pause_when_cost_limit_reached: v })} /></div>
            <div className="flex items-center justify-between text-sm"><span>Auto-pause on low QC pass rate</span><Switch checked={s.pause_when_qc_pass_rate_low} onCheckedChange={(v) => setS({ ...s, pause_when_qc_pass_rate_low: v })} /></div>
            <div className="flex items-center justify-between text-sm"><span>Safe publish to Store</span><Switch checked={s.safe_publish_to_store} onCheckedChange={(v) => setS({ ...s, safe_publish_to_store: v })} /></div>
            <div className="flex items-center justify-between text-sm"><span>Quality-first mode</span><Switch checked={s.quality_first_mode} onCheckedChange={(v) => setS({ ...s, quality_first_mode: v })} /></div>
            <Button className="w-full" onClick={() => patchSettings({
              daily_cost_cap_usd: s.daily_cost_cap_usd, max_books_per_day: s.max_books_per_day,
              max_parallel_books: s.max_parallel_books, max_parallel_heavy_jobs: s.max_parallel_heavy_jobs,
              minimum_qc_pass_rate: s.minimum_qc_pass_rate,
              pause_when_cost_limit_reached: s.pause_when_cost_limit_reached,
              pause_when_qc_pass_rate_low: s.pause_when_qc_pass_rate_low,
              safe_publish_to_store: s.safe_publish_to_store,
              quality_first_mode: s.quality_first_mode,
            })} disabled={saving}><Save className="size-4" /> Save daily limits</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Actions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={startRecommendedBatch} disabled={!!busy || capacity.recommendedStartsToday <= 0}>
              {busy === "batch" ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Start recommended batch ({capacity.recommendedStartsToday})
            </Button>
            <Button className="w-full" variant="outline" onClick={startOneNow} disabled={!!busy}>
              {busy === "one" ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />} Start one premium ebook now
            </Button>
            <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
              <p>Recommended starts respect cost cap, QC pass rate, parallelism, and idea pool.</p>
              <p>Never bypasses QC. Never publishes to Store until final gates pass.</p>
              <p>Budget-limited capacity: <b>{capacity.budgetLimitedCapacity}</b> · Time-limited: <b>{capacity.timeLimitedCapacity}</b> · Queue-limited: <b>{capacity.queueLimitedCapacity}</b></p>
              <p>Estimate per ebook: <b>${capacity.perBookCostEstimate.toFixed(3)}</b> · QC throttle: <b>{Math.round(capacity.qcThrottleFactor * 100)}%</b></p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category mix */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Category mix</CardTitle>
          <Button size="sm" onClick={saveMix} disabled={saving}><Save className="size-4" /> Save mix</Button>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-3">
            {mix.map((entry, idx) => {
              const p = STYLE_PROFILES_LITE.find((x) => x.slug === entry.slug);
              if (!p) return null;
              const todayCount = m.categoryMixToday[entry.slug] ?? 0;
              const weekCount = m.categoryMixWeek[entry.slug] ?? 0;
              return (
                <div key={entry.slug} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{p.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.tone} · {p.badge_label} · ${p.price_band.min}–${p.price_band.max} · illustrations: {p.illustration_density}
                        {p.requires_disclaimer && <span className="ml-2 text-orange-700">disclaimer</span>}
                      </div>
                    </div>
                    <Switch checked={entry.enabled} onCheckedChange={(v) => {
                      const copy = [...mix]; copy[idx] = { ...entry, enabled: v }; setMix(copy);
                    }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs w-16 shrink-0">Weight</Label>
                    <Input type="number" min={0} max={20} className="h-8" value={entry.weight} onChange={(e) => {
                      const copy = [...mix]; copy[idx] = { ...entry, weight: Number(e.target.value) }; setMix(copy);
                    }} />
                    <div className="text-xs text-muted-foreground shrink-0">today: {todayCount} · 7d: {weekCount}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${accent ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
