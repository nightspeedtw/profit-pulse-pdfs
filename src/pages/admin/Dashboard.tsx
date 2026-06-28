import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, Plane, Play, Pause, AlertTriangle, DollarSign, FileX, ImageOff,
  ShieldAlert, ShoppingBag, RefreshCw, FileText, ExternalLink, Sparkles, ClipboardCheck, Download,
} from "lucide-react";
import { Link } from "react-router-dom";
import { downloadAdminPdf } from "@/lib/pdf";
import { BADGE_OPTIONS, EbookBadgeKind, StatusBadge, resolveEbookBadge } from "@/components/admin/StatusBadge";

type Ebook = {
  id: string;
  title: string;
  category_id: string | null;
  autopilot_state: string | null;
  autopilot_mode: string | null;
  shopify_status: string | null;
  shopify_product_id: string | null;
  manuscript_qc_status: string | null;
  pdf_status: string | null;
  pdf_url: string | null;
  cover_url: string | null;
  word_count: number | null;
  final_quality_score: number | null;
  compliance_safety_score: number | null;
  cost_usd: number | null;
  needs_review_reason: string | null;
  updated_at: string;
  created_at: string;
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
  writing: number;
  needsReview: number;
  published: number;
  costToday: number;
  failedToday: number;
  qcPassToday: number;
  qcFailToday: number;
  shopifyDrafts: number;
};

type Category = { id: string; name: string };

type FilterState = {
  status: "all" | EbookBadgeKind;
  category: string;
  minScore: number;
  date: "all" | "today" | "7d" | "30d";
  failedOnly: boolean;
  draftUploaded: boolean;
  published: boolean;
};

const DEFAULT_FILTERS: FilterState = {
  status: "all",
  category: "all",
  minScore: 0,
  date: "all",
  failedOnly: false,
  draftUploaded: false,
  published: false,
};

export default function Dashboard() {
  const [ebooks, setEbooks] = useState<Ebook[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats>({
    producedToday: 0, writing: 0, needsReview: 0, published: 0,
    costToday: 0, failedToday: 0, qcPassToday: 0, qcFailToday: 0, shopifyDrafts: 0,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [
      { data: e },
      { data: s },
      { data: cats },
      { count: producedToday },
      { count: writing },
      { count: needsReview },
      { count: published },
      { data: costs },
      { count: failedToday },
      { count: qcPassToday },
      { count: qcFailToday },
      { count: shopifyDrafts },
    ] = await Promise.all([
      supabase.from("ebooks")
        .select("id,title,category_id,autopilot_state,autopilot_mode,shopify_status,shopify_product_id,manuscript_qc_status,pdf_status,pdf_url,cover_url,word_count,final_quality_score,compliance_safety_score,cost_usd,needs_review_reason,updated_at,created_at")
        .order("updated_at", { ascending: false }).limit(60),
      supabase.from("generation_settings").select("paused, autopilot_mode, daily_quota, daily_budget_usd, cost_limit_reached, cost_limit_reason").eq("id", 1).maybeSingle(),
      supabase.from("categories").select("id, name").order("name"),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).in("autopilot_state", ["running", "outline"]).or("autopilot_state.like.writing%"),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("autopilot_state", "needs_review"),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("shopify_status", "published"),
      supabase.from("cost_log").select("cost_usd").gte("created_at", since.toISOString()),
      supabase.from("pipeline_step_logs").select("id", { count: "exact", head: true }).eq("status", "fail").gte("started_at", since.toISOString()),
      supabase.from("pipeline_step_logs").select("id", { count: "exact", head: true }).eq("status", "ok").ilike("step_name", "%qc%").gte("started_at", since.toISOString()),
      supabase.from("pipeline_step_logs").select("id", { count: "exact", head: true }).eq("status", "fail").ilike("step_name", "%qc%").gte("started_at", since.toISOString()),
      supabase.from("ebooks").select("id", { count: "exact", head: true }).eq("shopify_status", "draft"),
    ]);
    setEbooks((e ?? []) as Ebook[]);
    setSettings(s as Settings | null);
    setCategories((cats ?? []) as Category[]);
    setStats({
      producedToday: producedToday ?? 0,
      writing: writing ?? 0,
      needsReview: needsReview ?? 0,
      published: published ?? 0,
      costToday: (costs ?? []).reduce((acc, r) => acc + Number(r.cost_usd ?? 0), 0),
      failedToday: failedToday ?? 0,
      qcPassToday: qcPassToday ?? 0,
      qcFailToday: qcFailToday ?? 0,
      shopifyDrafts: shopifyDrafts ?? 0,
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

  async function invoke(name: string, body: Record<string, unknown>, msg: string, key: string) {
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke(name, { body });
      if (error || (data as { error?: string } | null)?.error) {
        throw new Error(error?.message ?? (data as { error?: string }).error);
      }
      toast.success(msg);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function generateOneNow() {
    if (settings?.paused) {
      toast.error("Autopilot is paused — resume first.");
      return;
    }
    await invoke("autopilot-pipeline", { mode: settings?.autopilot_mode ?? "safe" }, "Started one ebook", "gen-one");
  }

  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    return ebooks.filter((e) => {
      const badge = resolveEbookBadge(e);
      if (filters.status !== "all" && badge !== filters.status) return false;
      if (filters.category !== "all" && e.category_id !== filters.category) return false;
      if (filters.minScore > 0 && (e.final_quality_score ?? 0) < filters.minScore) return false;
      if (filters.date !== "all") {
        const horizon = filters.date === "today" ? day : filters.date === "7d" ? 7 * day : 30 * day;
        if (now - new Date(e.updated_at).getTime() > horizon) return false;
      }
      if (filters.failedOnly && !["failed", "qc_failed", "rejected"].includes(badge)) return false;
      if (filters.draftUploaded && e.shopify_status !== "draft") return false;
      if (filters.published && e.shopify_status !== "published") return false;
      return true;
    });
  }, [ebooks, filters]);

  const autopilotKind: EbookBadgeKind = settings?.cost_limit_reached ? "paused"
    : settings?.paused ? "paused" : "ready";
  const costPct = settings ? Math.min(100, (stats.costToday / Math.max(0.01, Number(settings.daily_budget_usd))) * 100) : 0;
  const quotaPct = settings ? Math.min(100, (stats.producedToday / Math.max(1, settings.daily_quota)) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">[ Overview ]</p>
          <h1 className="font-display text-4xl uppercase">Ebook Factory</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={generateOneNow} disabled={busy === "gen-one" || settings?.paused}>
            {busy === "gen-one" ? <Loader2 className="size-4 animate-spin mr-1" /> : <Sparkles className="size-4 mr-1" />}
            Generate One Ebook
          </Button>
          <Link to="/admin/autopilot">
            <Button variant="outline"><Plane className="size-4 mr-1" /> Autopilot settings</Button>
          </Link>
        </div>
      </div>

      {/* Autopilot status card */}
      <Card className="border-2 border-foreground">
        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <StatusBadge kind={autopilotKind} />
              <span className="font-mono text-xs uppercase text-muted-foreground">Mode:</span>
              <span className="font-mono text-xs uppercase">{settings?.autopilot_mode ?? "safe"}</span>
              {settings?.cost_limit_reached && (
                <span className="text-xs text-red-700 font-bold flex items-center gap-1">
                  <DollarSign className="size-3" /> Cost limit reached
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-xl">
              <Meter label={`Today's production (${stats.producedToday} / ${settings?.daily_quota ?? 0})`} pct={quotaPct} tone="emerald" />
              <Meter label={`Daily cost ($${stats.costToday.toFixed(3)} / $${Number(settings?.daily_budget_usd ?? 0).toFixed(2)})`} pct={costPct} tone={costPct >= 90 ? "red" : "sky"} />
            </div>
            {settings?.cost_limit_reason && (
              <p className="text-xs text-muted-foreground">{settings.cost_limit_reason}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <Button onClick={togglePause} variant={settings?.paused ? "default" : "outline"} className="min-w-[150px]">
              {settings?.paused ? <Play className="size-4 mr-1" /> : <Pause className="size-4 mr-1" />}
              {settings?.paused ? "Resume Autopilot" : "Pause Autopilot"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi label="Produced today" value={stats.producedToday} />
        <Kpi label="Writing now"    value={stats.writing}    tone="text-sky-700" />
        <Kpi label="Needs review"   value={stats.needsReview} tone="text-orange-700" />
        <Kpi label="Published"      value={stats.published}  tone="text-emerald-700" />
        <Kpi label="Drafts uploaded" value={stats.shopifyDrafts} tone="text-violet-700" />
        <Kpi label="QC pass / fail" value={`${stats.qcPassToday} / ${stats.qcFailToday}`} tone={stats.qcFailToday > 0 ? "text-amber-700" : "text-emerald-700"} />
        <Kpi label="Cost today"     value={`$${stats.costToday.toFixed(3)}`} />
      </div>

      {/* Alerts */}
      {(stats.failedToday > 0 || settings?.cost_limit_reached) && (
        <Card className="border-2 border-orange-700 bg-orange-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-5 text-orange-700" /> Alerts (24h)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <AlertTile icon={<AlertTriangle className="size-4" />} label="Step failures" value={stats.failedToday} tone={stats.failedToday > 0 ? "orange" : "muted"} />
            <AlertTile icon={<FileX className="size-4" />}          label="PDF/Cover/Shopify errors" value={0} tone="muted" hidden />
            <AlertTile icon={<DollarSign className="size-4" />}     label="Cost guard" value={settings?.cost_limit_reached ? 1 : 0} tone={settings?.cost_limit_reached ? "red" : "muted"} />
            <AlertTile icon={<ImageOff className="size-4" />}       label="QC failures" value={stats.qcFailToday} tone={stats.qcFailToday > 0 ? "amber" : "muted"} />
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="border-2 border-foreground">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono uppercase">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <FilterField label="Status">
            <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v as EbookBadgeKind | "all" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {BADGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Category">
            <Select value={filters.category} onValueChange={(v) => setFilters((f) => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label={`Min QC score: ${filters.minScore}`}>
            <Input type="range" min={0} max={100} value={filters.minScore}
              onChange={(e) => setFilters((f) => ({ ...f, minScore: Number(e.target.value) }))} />
          </FilterField>
          <FilterField label="Date">
            <Select value={filters.date} onValueChange={(v) => setFilters((f) => ({ ...f, date: v as FilterState["date"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center gap-2"><Switch checked={filters.failedOnly} onCheckedChange={(v) => setFilters((f) => ({ ...f, failedOnly: v }))} /><Label className="text-xs">Failed only</Label></div>
            <div className="flex items-center gap-2"><Switch checked={filters.draftUploaded} onCheckedChange={(v) => setFilters((f) => ({ ...f, draftUploaded: v }))} /><Label className="text-xs">Draft uploaded</Label></div>
            <div className="flex items-center gap-2"><Switch checked={filters.published} onCheckedChange={(v) => setFilters((f) => ({ ...f, published: v }))} /><Label className="text-xs">Published only</Label></div>
          </div>
        </CardContent>
      </Card>

      {/* Ebook list */}
      <Card className="border-2 border-foreground">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-mono uppercase">Latest Ebooks ({filtered.length})</CardTitle>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="size-3 mr-1" /> Refresh</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b-2 border-foreground/20">
                <tr className="text-left font-mono uppercase text-[10px] tracking-wide">
                  <th className="p-3">Title</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">QC / Safety</th>
                  <th className="p-3">Words</th>
                  <th className="p-3">Cost</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">No ebooks match the current filters.</td></tr>
                )}
                {filtered.map((e) => {
                  const badge = resolveEbookBadge(e);
                  const showResume = badge === "failed" || badge === "qc_failed" || badge === "needs_review";
                  return (
                    <tr key={e.id} className="border-b border-foreground/10 align-top hover:bg-muted/30">
                      <td className="p-3 max-w-[360px]">
                        <Link to={`/admin/ebook/${e.id}`} className="font-medium hover:underline line-clamp-2">{e.title}</Link>
                        {e.needs_review_reason && <p className="text-[11px] text-orange-700 mt-1 line-clamp-2">⚠ {e.needs_review_reason}</p>}
                      </td>
                      <td className="p-3"><StatusBadge kind={badge} /></td>
                      <td className="p-3 text-xs text-muted-foreground">{e.category_id ? categoryMap[e.category_id] ?? "—" : "—"}</td>
                      <td className="p-3 text-xs font-mono">
                        <span className={e.final_quality_score && e.final_quality_score >= 85 ? "text-emerald-700 font-bold" : "text-muted-foreground"}>
                          {e.final_quality_score ?? "—"}
                        </span>
                        <span className="text-muted-foreground"> / </span>
                        <span className={e.compliance_safety_score && e.compliance_safety_score >= 90 ? "text-emerald-700 font-bold" : "text-muted-foreground"}>
                          {e.compliance_safety_score ?? "—"}
                        </span>
                      </td>
                      <td className="p-3 text-xs font-mono">{(e.word_count ?? 0).toLocaleString()}</td>
                      <td className="p-3 text-xs font-mono">${Number(e.cost_usd ?? 0).toFixed(3)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <Link to={`/admin/ebook/${e.id}`}>
                            <Button size="sm" variant="ghost" title="Open QC report"><ClipboardCheck className="size-3" /></Button>
                          </Link>
                          {showResume && (
                            <Button size="sm" variant="outline" title="Resume from failed step" disabled={busy === e.id}
                              onClick={() => invoke("autopilot-pipeline", { ebook_id: e.id, mode: settings?.autopilot_mode ?? "safe" }, "Resumed", e.id)}>
                              <RefreshCw className="size-3" />
                            </Button>
                          )}
                          {e.pdf_url && (
                            <a href={e.pdf_url} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="ghost" title="Open PDF"><FileText className="size-3" /></Button>
                            </a>
                          )}
                          {e.shopify_product_id && (
                            <Button size="sm" variant="outline" title="Open Shopify draft" asChild>
                              <a href={`https://admin.shopify.com/store/digital-wealth-hub-49qgj/products/${e.shopify_product_id}`} target="_blank" rel="noopener noreferrer">
                                <ShoppingBag className="size-3" />
                                <ExternalLink className="size-3 ml-1" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card className="border-2 border-foreground">
      <CardHeader className="pb-2"><CardTitle className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide">{label}</CardTitle></CardHeader>
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

function AlertTile({ icon, label, value, tone, hidden }: { icon: ReactNode; label: string; value: number; tone: "red" | "orange" | "amber" | "muted"; hidden?: boolean }) {
  if (hidden) return null;
  const cls = tone === "red" ? "border-red-700 bg-red-50 text-red-800"
    : tone === "orange" ? "border-orange-700 bg-orange-50 text-orange-800"
    : tone === "amber"  ? "border-amber-700 bg-amber-50 text-amber-900"
    : "border-foreground/20 text-muted-foreground";
  return (
    <div className={`border-2 p-2 flex items-center gap-2 ${cls}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono uppercase leading-tight">{label}</p>
        <p className="font-display text-xl leading-none">{value}</p>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide">{label}</Label>
      {children}
    </div>
  );
}
