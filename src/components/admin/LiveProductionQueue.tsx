import { useEffect, useState } from "react";
import { Activity, Clock, Loader2, PauseCircle, Wrench, AlertTriangle, ShieldCheck, Lock, Copy, CheckCircle2, Download, ExternalLink, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { fetchAdminData } from "@/lib/adminData";
import { statusView, elapsedSince, untilRetry } from "@/lib/canonicalStatus";
import { downloadAdminPdf } from "@/lib/pdf";
import { SystemFixCard, type SystemFix } from "./SystemFixCard";
import { QcGateCard, type QcGateReport, type ReRenderInfo } from "./QcGateCard";

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
  final_quality_score?: number | null;
  word_count?: number | null;
  shopify_status?: string | null;
  updated_at: string | null;
  qc?: QcGateReport | null;
  re_render?: ReRenderInfo | null;
}

interface LiveQueue {
  currently_working_on: QueueEbook[];
  queued: QueueEbook[];
  waiting: QueueEbook[];
  auto_fixing: QueueEbook[];
  needs_admin: QueueEbook[];
  needs_code_fix: QueueEbook[];
  ready_to_publish: QueueEbook[];
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
      <SectionReady items={data.ready_to_publish ?? []} />
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
      title="AI กำลังทำเล่มนี้อยู่ · Currently Working On"
      icon={<Activity className="h-4 w-4 text-primary" />}
      count={items.length}
      empty="ยังไม่มีเล่มที่กำลังผลิตอยู่ตอนนี้"
    >
      <div className="space-y-3">
        {items.map((e) => {
          const view = statusView(e.canonical_status);
          const pct = e.progress_pct ?? 0;
          return (
            <div
              key={e.id}
              className="rounded-md border-2 border-primary bg-primary/5 p-3 space-y-2 shadow-md ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground animate-pulse gap-1">
                      <Activity className="h-3 w-3" /> NOW RUNNING
                    </Badge>
                    <span className="font-semibold">
                      {e.title ?? `Ebook ${e.id.slice(0, 8)}`}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {view.label}
                    {e.current_step ? ` · ขั้นตอน: ${e.current_step}` : ""}
                    {e.current_subtask ? ` · ${e.current_subtask}` : ""}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <Badge variant="outline" className="border-primary text-primary font-bold">{pct}%</Badge>
                  <div className="text-muted-foreground mt-1">
                    Heartbeat: {elapsedSince(e.last_heartbeat_at)}
                  </div>
                </div>
              </div>
              <Progress value={pct} className="h-2" />
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
      title="เล่มต่อคิว · Queued Next"
      icon={<Clock className="h-4 w-4 text-muted-foreground" />}
      count={items.length}
      empty="ไม่มีเล่มรอคิวอยู่"
    >
      <ul className="space-y-2">
        {items.map((e, i) => (
          <li key={e.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
            <div>
              <div className="font-medium">
                #{e.queue_position ?? i + 1} {e.title ?? `Ebook ${e.id.slice(0, 8)}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {e.waiting_reason ?? "รอช่องผลิตว่าง"}
                {currentTitle ? ` — เริ่มหลังจาก "${currentTitle}"` : ""}
              </div>
            </div>
            <Badge variant="outline">รอคิว</Badge>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function SectionC({ items }: { items: QueueEbook[] }) {
  return (
    <SectionShell
      title="ติด limit แต่ระบบจะลองใหม่เอง · Waiting / Auto Retry"
      icon={<PauseCircle className="h-4 w-4 text-amber-600" />}
      count={items.length}
      empty="ไม่มีเล่มที่ติด limit"
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
                {v.helper ?? "ระบบจะลองใหม่ให้อัตโนมัติ"} — ลองใหม่ {untilRetry(e.next_retry_at)}
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
      title="ระบบกำลังแก้เอง · Auto-Fixing"
      icon={<Wrench className="h-4 w-4 text-amber-600" />}
      count={items.length}
      empty="ไม่มีเล่มที่ต้องซ่อมอัตโนมัติ"
    >
      <ul className="space-y-2">
        {items.map((e) => (
          <li key={e.id} className="rounded-md border p-2 text-sm">
            <div className="font-medium">{e.title ?? `Ebook ${e.id.slice(0, 8)}`}</div>
            <div className="text-xs text-muted-foreground">
              {e.current_subtask ?? "กำลังแก้ปัญหา"} — ครั้งที่ {e.autofix_attempt ?? 1}/
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
}: {
  fixes: SystemFix[];
  needsCode: QueueEbook[];
}) {
  const count = fixes.length + needsCode.length;

  const fixAll = async () => {
    if (fixes.length === 0) return;
    const combined = fixes
      .map(
        (f, i) =>
          `# Fix ${i + 1}/${fixes.length}: ${f.title}\n\n` +
          `**Detected problem:** ${f.detected_problem}\n` +
          (f.root_cause ? `**Root cause:** ${f.root_cause}\n` : "") +
          (f.affected_files?.length
            ? `**Affected files:**\n${f.affected_files.map((x) => `- ${x}`).join("\n")}\n`
            : "") +
          `\n${f.lovable_prompt}\n`,
      )
      .join("\n---\n\n");
    await navigator.clipboard.writeText(
      `Please fix the following ${fixes.length} Autopilot bug(s) detected by the self-debugging classifier:\n\n${combined}`,
    );
    toast.success(`Copied ${fixes.length} Lovable fix prompts — paste into Lovable chat`);
  };

  return (
    <SectionShell
      title="ระบบเจอบั๊ก เขียน prompt ให้ Lovable แก้โค้ด · Needs Code Fix"
      icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
      count={count}
      empty="ไม่พบบั๊กระดับโค้ด — Autopilot ทำงานปกติ"
    >
      <div className="space-y-3">
        {fixes.length > 1 && (
          <div className="flex justify-end">
            <Button size="sm" variant="destructive" onClick={fixAll} className="gap-2">
              <Copy className="h-4 w-4" /> Fix All ({fixes.length}) → Lovable
            </Button>
          </div>
        )}
        {fixes.map((f) => (
          <SystemFixCard key={f.id} fix={f} />
        ))}
        {needsCode.map((e) => (
          <div key={e.id} className="rounded-md border p-2 text-sm">
            <div className="font-medium">{e.title ?? e.id}</div>
            <div className="text-xs text-muted-foreground">
              {e.waiting_reason ?? "รอ Lovable แก้โค้ด"}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function SectionF({ needsAdmin }: { needsAdmin: QueueEbook[] }) {
  return (
    <SectionShell
      title="ต้องให้แอดมินช่วย · Needs Admin"
      icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
      count={needsAdmin.length}
      empty="ไม่มีปัญหาที่ต้องให้แอดมินเข้ามาแก้"
    >
      <ul className="space-y-1 text-sm">
        {needsAdmin.map((e) => (
          <li key={e.id} className="rounded-md border p-2">
            <div className="font-medium">{e.title ?? e.id}</div>
            <div className="text-xs text-muted-foreground">
              {e.waiting_reason ?? "ระบบแก้เองไม่ได้ ต้องให้แอดมินตัดสินใจ"}
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function SectionReady({ items }: { items: QueueEbook[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  const onDownload = async (e: QueueEbook) => {
    setBusy(e.id);
    try {
      await downloadAdminPdf(e.id, e.title ?? undefined);
      toast.success("Downloaded PDF");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionShell
      title="พร้อมพรีวิว · Ready to Publish (100%)"
      icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
      count={items.length}
      empty="ยังไม่มีเล่มที่ผลิตเสร็จ 100%"
    >
      <div className="space-y-3">
        {items.map((e) => {
          const pdfReady = !!e.pdf_url;
          return (
            <div
              key={e.id}
              className="rounded-md border-2 border-emerald-600/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 flex flex-wrap gap-3 items-start"
            >
              {e.cover_url ? (
                <img
                  src={e.cover_url}
                  alt={e.title ?? "cover"}
                  className="h-20 w-14 object-cover rounded border shadow-sm"
                />
              ) : (
                <div className="h-20 w-14 rounded border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                  no cover
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-emerald-600 text-white gap-1">
                    <CheckCircle2 className="h-3 w-3" /> 100% — พร้อมพรีวิว
                  </Badge>
                  <span className="font-semibold truncate">
                    {e.title ?? `Ebook ${e.id.slice(0, 8)}`}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                  {e.final_quality_score != null && (
                    <span>QC {Math.round(e.final_quality_score)}</span>
                  )}
                  {e.word_count != null && (
                    <span>{e.word_count.toLocaleString()} words</span>
                  )}
                  {!pdfReady && <span className="text-amber-600">PDF ยังไม่พร้อม</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => onDownload(e)}
                  disabled={!pdfReady || busy === e.id}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  {busy === e.id ? "กำลังโหลด…" : "Download PDF"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => e.pdf_url && window.open(e.pdf_url, "_blank", "noopener,noreferrer")}
                  disabled={!pdfReady}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" /> Open
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled
                  title="Phase ถัดไป — จะเปิดใช้งานเมื่อพร้อมอัพ Shopify"
                  className="gap-2"
                >
                  <ShoppingBag className="h-4 w-4" /> Push to Shopify
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}

