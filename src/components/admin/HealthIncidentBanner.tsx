// HealthIncidentBanner — red banner shown on admin dashboard + Kids Autopilot
// page when the health-monitor cron has recorded one or more active critical
// conditions in the last 6 hours (matches the email-cooldown window).
//
// Renders a plain-language TH+EN summary per alert with the affected book /
// provider named and a one-line "what to do" hint, so the owner never has to
// parse raw metric titles.
import { useEffect, useState } from "react";
import { AlertOctagon, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type ActiveCritical = {
  id?: string;
  alert_class: string;
  title: string;
  body: string;
  severity: string;
  created_at: string;
};

type StatusPayload = {
  ok: boolean;
  current_incident?: ActiveCritical | null;
  queued_incidents?: number;
  active_critical: ActiveCritical[];
  autopilot_frozen?: boolean;
  heartbeat?: { newest: string | null; dead: boolean; sources: Array<{source:string; last_beat_at:string}> };
  last_checked_at: string | null;
  resend_configured: boolean;
};

function ago(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} hr ago`;
}

// ---------------------------------------------------------------------------
// Plain-language translator: derives a TH+EN one-liner, affected entity list,
// and a "what to do next" hint from the raw alert body. Works from the
// alert_class + body already stored in alert_log — no backend change needed.
// ---------------------------------------------------------------------------

type Plain = {
  emoji: string;
  th: string;      // Thai one-liner
  en: string;      // English one-liner
  entities: string[]; // affected books / providers / (book,step) pairs
  hint: string;    // one-line "what to do"
};

function firstNumber(s: string, re: RegExp): number | null {
  const m = s.match(re);
  return m ? Number(m[1]) : null;
}

function extractBullets(body: string, limit = 4): string[] {
  return body.split("\n").filter(l => l.trim().startsWith("•")).slice(0, limit)
    .map(l => l.replace(/^•\s*/, "").trim());
}

function translate(a: ActiveCritical): Plain {
  const b = a.body || "";
  switch (a.alert_class) {
    case "worker_dead": {
      const queued = firstNumber(a.title, /with (\d+) queued/) ?? firstNumber(b, /(\d+) books are queued/) ?? 0;
      const min = firstNumber(a.title, /\((\d+) min/);
      const neverRecorded = /\(never/i.test(a.title);
      const staleTxt = neverRecorded ? "ยังไม่เคยบันทึก heartbeat" : (min ? `${min} นาที` : "นานเกินไป");
      const staleEn = neverRecorded ? "no heartbeat ever recorded" : `${min ?? "??"} min stale`;
      return {
        emoji: "🛑",
        th: `Worker ไม่เต้น (${staleTxt}) — มี ${queued} เล่มค้างคิว`,
        en: `Worker heartbeat ${staleEn} · ${queued} book(s) waiting in queue`,
        entities: [`queue: ${queued}`],
        hint: "ตรวจ dispatcher cron / edge function stall แล้วสั่ง Auto-Publisher tick ใหม่",
      };
    }
    case "book_stuck": {
      const count = firstNumber(a.title, /^(\d+) book/) ?? 0;
      return {
        emoji: "⏳",
        th: `${count} เล่มค้างสถานะเดิม > 30 นาที (ยังไม่มี blocker)`,
        en: `${count} book(s) stuck in an active status for over 30 min with no blocker`,
        entities: extractBullets(b),
        hint: "รีสตาร์ท step ด้วย stall-watchdog หรือ retire แล้วสร้างใหม่",
      };
    }
    case "provider_blocked": {
      const providers = a.title.replace(/^Provider billing block active:\s*/, "").trim();
      return {
        emoji: "💳",
        th: `Provider โดนบล็อกเรื่องเงิน: ${providers}`,
        en: `Provider billing block active on: ${providers}`,
        entities: providers.split(",").map(p => p.trim()).filter(Boolean),
        hint: "เติมเครดิต / ตรวจ quota ที่หน้า dashboard ของ provider นั้น แล้วเคลียร์ latch",
      };
    }
    case "queue_frozen": {
      const q = firstNumber(a.title, /Queue frozen:\s*(\d+)/) ?? 0;
      return {
        emoji: "🧊",
        th: `คิวไม่ขยับ: ${q} เล่ม รออยู่ ไม่มี dispatch 3 รอบติด (45 นาที)`,
        en: `Queue frozen at ${q} book(s) — zero dispatches across 3 ticks (~45 min)`,
        entities: [`queued: ${q}`],
        hint: "เรียก coloring-autopilot-tick ด้วยมือ; ถ้ายังนิ่ง ให้เช็ค provider block และ dispatcher log",
      };
    }
    case "spend_ceiling": {
      const spend = a.title.match(/\$([\d.]+) exceeds/)?.[1];
      const cap = a.title.match(/ceiling \$([\d.]+)/)?.[1];
      return {
        emoji: "💸",
        th: `ใช้เงินวันนี้ $${spend} เกินเพดาน $${cap}`,
        en: `24h runtime spend $${spend} exceeds ceiling $${cap}`,
        entities: [`spend 24h: $${spend}`, `cap: $${cap}`],
        hint: "ขึ้นเพดานใน platform_settings.health_spend_ceiling_usd หรือหยุด autopilot ชั่วคราว",
      };
    }
    case "unbounded_retry": {
      const pairs = firstNumber(a.title, /^(\d+) \(book, step\)/) ?? 0;
      const bullets = extractBullets(b, 5);
      // Turn "<uuid>|<step> — N paid calls" into short "<step> ×N (<book8>)"
      const short = bullets.map(line => {
        const m = line.match(/^([0-9a-f-]+)\|([^\s]+)\s+—\s+(\d+)/i);
        if (!m) return line;
        return `${m[2]} ×${m[3]} (book ${m[1].slice(0, 8)})`;
      });
      return {
        emoji: "🔁",
        th: `${pairs} คู่ (เล่ม × step) ยิง paid call เกิน 5 ครั้งใน 24 ชม.`,
        en: `${pairs} (book, step) pair(s) exceeded 5 paid calls in 24h — retry storm`,
        entities: short,
        hint: "ใส่ hard-cap ให้ step ที่ซ้ำ (แบบเดียวกับ cover) หรือ retire เล่มที่ค้าง",
      };
    }
    default:
      return {
        emoji: "⚠️",
        th: a.title,
        en: a.title,
        entities: extractBullets(b),
        hint: "ตรวจรายละเอียดที่ /admin",
      };
  }
}

async function callHealthMonitor(mode: string, body?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(`health-monitor?mode=${mode}`, { body: body ?? {} });
  if (error) throw error;
  return data;
}

export function HealthIncidentBanner() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const projectRef = "atccyjuwimibyoocpiwi";
      const res = await fetch(
        `https://${projectRef}.supabase.co/functions/v1/health-monitor?mode=status`,
        { headers: { apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ?? "" } },
      );
      if (res.ok) setStatus(await res.json());
    } catch {
      try {
        const data = await callHealthMonitor("status");
        if (data) setStatus(data as StatusPayload);
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
      timer = setTimeout(tick, 30_000);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const resolveCurrent = async () => {
    const cur = status?.current_incident ?? status?.active_critical?.[0];
    if (!cur) return;
    setBusy(true);
    try {
      await callHealthMonitor("resolve", cur.id ? { id: cur.id } : { alert_class: cur.alert_class });
      await refresh();
    } finally { setBusy(false); }
  };

  const toggleFreeze = async () => {
    setBusy(true);
    try {
      await callHealthMonitor(status?.autopilot_frozen ? "unfreeze" : "freeze");
      await refresh();
    } finally { setBusy(false); }
  };

  if (loading || !status) return null;

  const current = status.current_incident ?? status.active_critical?.[0] ?? null;
  const queued = status.queued_incidents ?? Math.max(0, (status.active_critical?.length ?? 0) - 1);
  const frozen = !!status.autopilot_frozen;
  const dead = !!status.heartbeat?.dead;

  if (!current && !frozen && !dead) {
    if (!status.resend_configured) {
      return (
        <Card className="border border-amber-500/60 bg-amber-500/5">
          <CardContent className="p-3 text-xs text-amber-700 dark:text-amber-400">
            Health monitor active · email alerts pending Resend key (last checked {ago(status.last_checked_at)})
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  const p = current ? translate(current) : null;

  return (
    <Card className={`border-2 ${frozen ? "border-blue-600 bg-blue-500/5" : "border-red-600 bg-red-500/5"}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded ${frozen ? "bg-blue-500/20" : "bg-red-500/20"}`}>
            <AlertOctagon className={`h-5 w-5 ${frozen ? "text-blue-600" : "text-red-600 animate-pulse"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[11px] font-mono uppercase tracking-wide ${frozen ? "text-blue-700 dark:text-blue-400" : "text-red-700 dark:text-red-400"}`}>
              {frozen ? "AUTOPILOT FROZEN" : "Active incident"} · ตรวจล่าสุด {ago(status.last_checked_at)}
              {queued > 0 && <span className="ml-2">· คิวถัดไป {queued}</span>}
              {dead && <span className="ml-2 text-red-700">· heartbeat DEAD ({ago(status.heartbeat?.newest)})</span>}
            </div>
            <div className={`text-base font-semibold ${frozen ? "text-blue-700 dark:text-blue-400" : "text-red-700 dark:text-red-400"}`}>
              {frozen ? "🧊 Autopilot หยุดค้างตามคำสั่ง — ไม่มี dispatch อัตโนมัติ" : `🔴 ${p?.th ?? current?.title}`}
            </div>
            {!frozen && p && (
              <div className="text-xs text-muted-foreground">{p.en}</div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className={frozen ? "border-blue-600 text-blue-700" : "border-red-600 text-red-700"}>
              {status.resend_configured ? "email: live" : "email: pending"}
            </Badge>
            <button
              onClick={toggleFreeze}
              disabled={busy}
              className={`text-[11px] px-2 py-1 rounded border ${frozen ? "border-blue-600 text-blue-700 hover:bg-blue-500/10" : "border-muted-foreground text-muted-foreground hover:bg-muted"}`}
            >
              {frozen ? "▶ Unfreeze autopilot" : "⏸ Freeze autopilot"}
            </button>
          </div>
        </div>

        {current && p && !frozen && (
          <div className="rounded-md border border-red-600/30 bg-background/50 p-3">
            {p.entities.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {p.entities.map((e, i) => (
                  <span key={i} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[280px]">
                    {e}
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs text-foreground/80">
              <span className="font-semibold text-red-700 dark:text-red-400">ต้องทำ / next: </span>
              {p.hint}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-[10px] font-mono text-muted-foreground">
                class={current.alert_class} · detected {ago(current.created_at)}
              </div>
              <button
                onClick={resolveCurrent}
                disabled={busy}
                className="text-xs px-2 py-1 rounded border border-green-600 text-green-700 hover:bg-green-500/10"
              >
                ✓ Mark resolved
              </button>
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />working…
          </div>
        )}
      </CardContent>
    </Card>
  );
}
