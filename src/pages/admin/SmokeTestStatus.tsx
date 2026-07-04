// Realtime status view for the 3-category smoke-test ebooks.
// Polls every 5s. Shows: current step, run status, active lock,
// rough ETA (based on median step duration), and quick links.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AUTOPILOT_STEPS, stepLabel } from "@/lib/autopilot-steps";
import { RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, Clock, Lock } from "lucide-react";

// The 3 smoke-test ebooks (Finance / Health / Productivity).
const SMOKE_IDS = [
  { id: "1bb4ea70-56bd-4951-9dae-e911783b515b", cat: "💰 Personal Finance" },
  { id: "c999c7db-c2c1-44d7-add9-74418c691df2", cat: "🧘 Health & Wellness" },
  { id: "1a9f995e-799d-45f0-be33-cedc3313c7fe", cat: "⚡ Productivity" },
];

type EbookRow = {
  id: string;
  title: string | null;
  status: string | null;
  cover_url: string | null;
  store_thumbnail_url: string | null;
  pdf_url: string | null;
  listed_at: string | null;
  updated_at: string | null;
  qc_downgraded?: boolean | null;
  qc_notes?: string | null;
};
type RunRow = {
  id: string;
  ebook_id: string;
  status: string | null;
  current_step: string | null;
  started_at: string | null;
  updated_at: string | null;
};
type StepRow = {
  ebook_id: string;
  step_name: string;
  status: string;
  message: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
};
type LockRow = { name: string; holder_ebook_id: string | null; expires_at: string };

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function stepIndex(name: string | null | undefined): number {
  if (!name) return 0;
  const idx = AUTOPILOT_STEPS.findIndex((s) => s.name === name);
  return idx < 0 ? 0 : idx;
}

function statusVariant(s?: string | null) {
  if (!s) return "outline" as const;
  if (["completed", "passed", "ok"].includes(s)) return "default" as const;
  if (["failed", "needs_admin"].includes(s)) return "destructive" as const;
  if (["running", "auto_fixing", "starting"].includes(s)) return "secondary" as const;
  return "outline" as const;
}

export default function SmokeTestStatus() {
  const [ebooks, setEbooks] = useState<EbookRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [locks, setLocks] = useState<LockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastTick, setLastTick] = useState<Date>(new Date());

  async function load() {
    const ids = SMOKE_IDS.map((s) => s.id);
    const [e, r, s, l] = await Promise.all([
      supabase.from("ebooks")
        .select("id,title,status,cover_url,store_thumbnail_url,pdf_url,listed_at,updated_at")
        .in("id", ids),
      supabase.from("autopilot_pipeline_runs")
        .select("id,ebook_id,status,current_step,started_at,updated_at")
        .in("ebook_id", ids)
        .neq("status", "superseded")
        .order("updated_at", { ascending: false }),
      supabase.from("autopilot_pipeline_steps")
        .select("ebook_id,step_name,status,message,error_message,started_at,completed_at,duration_ms")
        .in("ebook_id", ids)
        .order("completed_at", { ascending: false, nullsFirst: false })
        .limit(60),
      supabase.from("production_locks").select("name,holder_ebook_id,expires_at"),
    ]);
    setEbooks((e.data ?? []) as EbookRow[]);
    setRuns((r.data ?? []) as RunRow[]);
    setSteps((s.data ?? []) as StepRow[]);
    setLocks((l.data ?? []) as LockRow[]);
    setLastTick(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const medianStepMs = useMemo(() => {
    const ok = steps.filter((s) => s.duration_ms && s.duration_ms > 0).map((s) => s.duration_ms as number);
    if (!ok.length) return 30_000;
    ok.sort((a, b) => a - b);
    return ok[Math.floor(ok.length / 2)];
  }, [steps]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl uppercase">Smoke Test — 3-Category Live Status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-refresh every 5s • last update {fmtAgo(lastTick.toISOString())}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="size-4" /> Refresh now
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {SMOKE_IDS.map(({ id, cat }) => {
          const book = ebooks.find((e) => e.id === id);
          const run = runs.find((r) => r.ebook_id === id);
          const bookSteps = steps.filter((s) => s.ebook_id === id);
          const lastStep = bookSteps[0];
          const lock = locks.find((l) => l.holder_ebook_id === id);
          const idx = stepIndex(run?.current_step);
          const remaining = Math.max(0, AUTOPILOT_STEPS.length - idx - 1);
          const etaMs = remaining * medianStepMs;
          const etaMin = Math.round(etaMs / 60000);
          const pct = Math.round((idx / (AUTOPILOT_STEPS.length - 1)) * 100);

          const isPublished = !!book?.listed_at;
          const isSoftPass = !!book?.qc_downgraded;
          const isBlocked = run?.status === "needs_admin" || book?.status === "needs_review";

          return (
            <Card key={id} className="p-5 space-y-4 border-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono uppercase text-muted-foreground">{cat}</div>
                  <div className="font-display text-lg leading-tight truncate mt-1">
                    {book?.title ?? "—"}
                  </div>
                </div>
                {isPublished ? (
                  <Badge className="shrink-0 gap-1"><CheckCircle2 className="size-3" />Live</Badge>
                ) : isBlocked ? (
                  <Badge variant="destructive" className="shrink-0 gap-1"><AlertTriangle className="size-3" />Blocked</Badge>
                ) : isSoftPass ? (
                  <Badge variant="outline" className="shrink-0 gap-1 border-yellow-500 text-yellow-700"><Clock className="size-3" />QC Soft-Pass</Badge>
                ) : (
                  <Badge variant="secondary" className="shrink-0 gap-1"><Clock className="size-3" />Working</Badge>
                )}
              </div>

              {/* progress */}
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono uppercase">{stepLabel(run?.current_step)}</span>
                  <span className="text-muted-foreground">{pct}%</span>
                </div>
                <div className="h-2 bg-muted mt-1 border border-foreground/20 overflow-hidden">
                  <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground uppercase font-mono">Run status</div>
                  <Badge variant={statusVariant(run?.status)} className="mt-1">
                    {run?.status ?? "—"}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-mono">Ebook status</div>
                  <Badge variant={statusVariant(book?.status)} className="mt-1">
                    {book?.status ?? "—"}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-mono">Last update</div>
                  <div className="mt-1">{fmtAgo(run?.updated_at ?? book?.updated_at ?? null)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-mono">Rough ETA</div>
                  <div className="mt-1">
                    {isPublished ? "—" : isBlocked ? "manual fix needed" : `~${etaMin}m`}
                  </div>
                </div>
              </div>

              {lock && (
                <div className="flex items-center gap-2 text-xs px-2 py-1.5 bg-muted border border-foreground/20">
                  <Lock className="size-3" />
                  <span className="font-mono">{lock.name}</span>
                  <span className="text-muted-foreground ml-auto">exp {fmtAgo(lock.expires_at)}</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-1 text-[10px] font-mono uppercase">
                <div className={`px-2 py-1 border text-center ${book?.cover_url ? "border-foreground bg-highlight" : "border-foreground/20 text-muted-foreground"}`}>
                  Cover {book?.cover_url ? "✓" : "—"}
                </div>
                <div className={`px-2 py-1 border text-center ${book?.pdf_url ? "border-foreground bg-highlight" : "border-foreground/20 text-muted-foreground"}`}>
                  PDF {book?.pdf_url ? "✓" : "—"}
                </div>
                <div className={`px-2 py-1 border text-center ${book?.listed_at ? "border-foreground bg-highlight" : "border-foreground/20 text-muted-foreground"}`}>
                  Listed {book?.listed_at ? "✓" : "—"}
                </div>
              </div>

              {(lastStep?.error_message || lastStep?.message) && isBlocked && (
                <div className="text-xs bg-destructive/10 border border-destructive/40 p-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                  {lastStep.error_message || lastStep.message}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t">
                <Button asChild size="sm" variant="outline" className="flex-1">
                  <Link to={`/admin/ebook/${id}`}>
                    <ExternalLink className="size-3" /> Review
                  </Link>
                </Button>
                {run?.id && (
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link to={`/admin/autopilot/run/${run.id}`}>
                      Run log
                    </Link>
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
    </div>
  );
}
