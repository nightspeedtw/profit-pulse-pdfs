import { useEffect, useState } from "react";
import { Activity, Clock, Loader2, PauseCircle, Wrench, AlertTriangle, ShieldCheck, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { fetchAdminData } from "@/lib/adminData";
import { statusView, elapsedSince, untilRetry } from "@/lib/canonicalStatus";
import { SystemFixCard, type SystemFix } from "./SystemFixCard";

interface QueueEbook {
  id: string;
  title: string | null;
  canonical_status: string | null;
  queue_position: number | null;
  waiting_reason: string | null;
  current_step: string | null;
  current_subtask: string | null;
  progress_pct: number | null;
  last_heartbeat_at: string | null;
  current_qc_score: number | null;
  autofix_attempt: number | null;
  autofix_max: number | null;
  next_retry_at: string | null;
  cover_url: string | null;
  pdf_url: string | null;
  updated_at: string | null;
}

interface LiveQueue {
  currently_working_on: QueueEbook[];
  queued: QueueEbook[];
  waiting: QueueEbook[];
  auto_fixing: QueueEbook[];
  needs_admin: QueueEbook[];
  needs_code_fix: QueueEbook[];
  system_fixes: SystemFix[];
  heavy_production_lock: { holder_ebook_id: string | null; expires_at: string } | null;
}

export function LiveProductionQueue() {
  const [data, setData] = useState<LiveQueue | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const d = await fetchAdminData<LiveQueue>("live_queue");
        if (cancelled) return;
        setData(d);
        setErr(null);
        const active =
          d.currently_working_on.length + d.queued.length + d.auto_fixing.length + d.waiting.length;
        timer = setTimeout(tick, active > 0 ? 3000 : 15000);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        timer = setTimeout(tick, 10000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (err) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          Live queue error: {err}
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading live queue…
        </CardContent>
      </Card>
    );
  }

  const current = data.currently_working_on[0] ?? null;
  const lockActive = !!data.heavy_production_lock?.holder_ebook_id;
  const totalWaiting =
    data.queued.length + data.waiting.length + data.auto_fixing.length;

  return (
    <div className="space-y-4">
      <SafeModeBanner
        current={current}
        lockActive={lockActive}
        lockExpiresAt={data.heavy_production_lock?.expires_at ?? null}
        totalWaiting={totalWaiting}
      />
      <SectionA items={data.currently_working_on} />
      <SectionB items={data.queued} currentTitle={current?.title ?? null} />
      <SectionC items={data.waiting} />
      <SectionD items={data.auto_fixing} />
      <SectionE fixes={data.system_fixes} needsCode={data.needs_code_fix} />
      <SectionF needsAdmin={data.needs_admin} />

    </div>
  );
}

function SafeModeBanner({
  current,
  lockActive,
  lockExpiresAt,
  totalWaiting,
}: {
  current: QueueEbook | null;
  lockActive: boolean;
  lockExpiresAt: string | null;
  totalWaiting: number;
}) {
  return (
    <Card className="border-2 border-foreground/20 bg-muted/30">
      <CardContent className="p-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Sequential Safe Mode
        </div>
        <span className="text-xs text-muted-foreground">
          Only one ebook in heavy production. PDF render + Shopify upload are strictly one-by-one.
          Topic/idea generation runs in parallel.
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {lockActive ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" />
              Production slot held
              {current?.title ? ` by "${current.title}"` : ""}
              {lockExpiresAt ? ` · lease ${untilRetry(lockExpiresAt)}` : ""}
            </Badge>
          ) : (
            <Badge variant="secondary">Production slot: free</Badge>
          )}
          <Badge variant="secondary">{totalWaiting} waiting</Badge>
        </div>
      </CardContent>
    </Card>
  );
}


function SectionShell({
  title,
  icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          <Badge variant="secondary" className="ml-auto">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function SectionA({ items }: { items: QueueEbook[] }) {
  return (
    <SectionShell
      title="Currently Working On"
      icon={<Activity className="h-4 w-4 text-primary" />}
      count={items.length}
      empty="No ebook is currently being produced."
    >
      <div className="space-y-3">
        {items.map((e) => {
          const view = statusView(e.canonical_status);
          const pct = e.progress_pct ?? 0;
          return (
            <div key={e.id} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    Now producing: {e.title ?? `Ebook ${e.id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {view.label}
                    {e.current_step ? ` · Step: ${e.current_step}` : ""}
                    {e.current_subtask ? ` · ${e.current_subtask}` : ""}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <Badge variant="outline">{pct}%</Badge>
                  <div className="text-muted-foreground mt-1">
                    Last heartbeat: {elapsedSince(e.last_heartbeat_at)}
                  </div>
                </div>
              </div>
              <Progress value={pct} className="h-1.5" />
              <div className="flex gap-2 text-xs text-muted-foreground">
                {e.current_qc_score != null && <span>QC {Math.round(e.current_qc_score)}</span>}
                {e.autofix_attempt != null && e.autofix_attempt > 0 && (
                  <span>Auto-fix {e.autofix_attempt}/{e.autofix_max ?? 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}

function SectionB({ items, currentTitle }: { items: QueueEbook[]; currentTitle: string | null }) {
  return (
    <SectionShell
      title="Queued Next"
      icon={<Clock className="h-4 w-4 text-muted-foreground" />}
      count={items.length}
      empty="No ebooks queued."
    >
      <ul className="space-y-2">
        {items.map((e, i) => (
          <li key={e.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
            <div>
              <div className="font-medium">
                #{e.queue_position ?? i + 1} {e.title ?? `Ebook ${e.id.slice(0, 8)}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {e.waiting_reason ?? "Waiting for production slot"}
                {currentTitle ? ` — starts after "${currentTitle}"` : ""}
              </div>
            </div>
            <Badge variant="outline">Queued</Badge>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function SectionC({ items }: { items: QueueEbook[] }) {
  return (
    <SectionShell
      title="Waiting / Paused Automatically"
      icon={<PauseCircle className="h-4 w-4 text-amber-600" />}
      count={items.length}
      empty="No ebooks waiting on external limits."
    >
      <ul className="space-y-2">
        {items.map((e) => {
          const v = statusView(e.canonical_status);
          return (
            <li key={e.id} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">{e.title ?? `Ebook ${e.id.slice(0, 8)}`}</div>
                <Badge variant="secondary">{v.label}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {v.helper ?? "Auto-resumes"} — retry {untilRetry(e.next_retry_at)}
              </div>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

function SectionD({ items }: { items: QueueEbook[] }) {
  return (
    <SectionShell
      title="Auto-Fixing"
      icon={<Wrench className="h-4 w-4 text-amber-600" />}
      count={items.length}
      empty="No ebooks currently self-repairing."
    >
      <ul className="space-y-2">
        {items.map((e) => (
          <li key={e.id} className="rounded-md border p-2 text-sm">
            <div className="font-medium">{e.title ?? `Ebook ${e.id.slice(0, 8)}`}</div>
            <div className="text-xs text-muted-foreground">
              {e.current_subtask ?? "Repairing issue"} — attempt {e.autofix_attempt ?? 1}/
              {e.autofix_max ?? 3}
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function SectionE({
  fixes,
  needsCode,
  needsAdmin,
}: {
  fixes: SystemFix[];
  needsCode: QueueEbook[];
  needsAdmin: QueueEbook[];
}) {
  const codeCount = fixes.length + needsCode.length;
  return (
    <SectionShell
      title="Needs Code Fix / System Repair"
      icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
      count={codeCount + needsAdmin.length}
      empty="No system-level issues detected. Autopilot is healthy."
    >
      <div className="space-y-3">
        {fixes.map((f) => (
          <SystemFixCard key={f.id} fix={f} />
        ))}
        {needsAdmin.length > 0 && (
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium text-destructive">Admin attention required</div>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {needsAdmin.map((e) => (
                <li key={e.id}>
                  {e.title ?? e.id} — {e.waiting_reason ?? "Cannot be fixed automatically"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionShell>
  );
}
