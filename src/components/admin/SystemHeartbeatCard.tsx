// System Heartbeat — plain-Thai "what is the system doing RIGHT NOW" summary.
// Answers the four questions the operator keeps asking:
//   1) กำลังทำเล่มไหน?  2) ทำไมหยุด?  3) ต่อไปคืออะไร?  4) ต้องช่วยไหม?
import { useEffect, useState } from "react";
import { Activity, Loader2, PlayCircle, AlertCircle, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchAdminData } from "@/lib/adminData";
import { toast } from "sonner";

type Ebook = {
  id: string;
  title: string | null;
  current_step_label?: string | null;
  current_step?: string | null;
  current_action_message?: string | null;
  last_heartbeat_at?: string | null;
  progress_pct?: number | null;
  waiting_reason?: string | null;
  blocker_reason?: string | null;
};

type Live = {
  currently_working_on: Ebook[];
  queued: Ebook[];
  waiting: Ebook[];
  auto_fixing: Ebook[];
  needs_admin: Ebook[];
  needs_code_fix: Ebook[];
  ready_to_publish: Ebook[];
  heavy_production_lock: { holder_ebook_id: string | null } | null;
};

function ago(iso?: string | null): string {
  if (!iso) return "—";
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ที่แล้ว`;
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`;
}

export function SystemHeartbeatCard() {
  const [live, setLive] = useState<Live | null>(null);
  const [kicking, setKicking] = useState(false);
  const [lastAutoKickAt, setLastAutoKickAt] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await fetchAdminData<Live>("live_queue");
        if (cancelled) return;
        setLive(d);
      } catch {
        /* silent — LiveProductionQueue below surfaces errors */
      }
      timer = setTimeout(tick, 5000);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const kick = async (opts: { silent?: boolean } = {}) => {
    setKicking(true);
    try {
      const { error } = await supabase.functions.invoke("autopilot-recovery-worker", { body: {} });
      if (error) throw error;
      if (!opts.silent) toast.success("Recovery worker started — เล่มถัดไปจะเริ่มใน <10 วินาที");
    } catch (e) {
      if (!opts.silent) toast.error(e instanceof Error ? e.message : "Kick failed");
    } finally {
      setKicking(false);
    }
  };

  // Auto-Kick: whenever no book is actively producing but work exists
  // (queued / waiting-retry / auto-fixing / ready-to-publish), fire the
  // recovery worker automatically. Debounced to once per 45s so we never
  // hammer the edge function.
  useEffect(() => {
    if (!live) return;
    const running = live.currently_working_on.length > 0;
    const workAvailable =
      live.queued.length +
      live.waiting.length +
      live.auto_fixing.length +
      live.ready_to_publish.length > 0;
    if (running || !workAvailable) return;
    const now = Date.now();
    if (now - lastAutoKickAt < 45_000) return;
    setLastAutoKickAt(now);
    kick({ silent: true });
  }, [live, lastAutoKickAt]);

  if (!live) {
    return (
      <Card className="border-2 border-foreground bg-muted/30">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดสถานะระบบ…
        </CardContent>
      </Card>
    );
  }

  const current = live.currently_working_on[0] ?? null;
  const next = live.queued[0] ?? null;
  const totalToDo =
    live.queued.length + live.waiting.length + live.auto_fixing.length;
  const totalReady = live.ready_to_publish.length;
  const totalBlocked = live.needs_admin.length + live.needs_code_fix.length;

  const running = !!current;
  const stalled = !running && totalToDo > 0;
  const idle = !running && totalToDo === 0;

  return (
    <Card className={`border-2 ${running ? "border-green-500 bg-green-500/5" : stalled ? "border-amber-500 bg-amber-500/5" : "border-foreground bg-muted/20"}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`p-2 rounded ${running ? "bg-green-500/20" : stalled ? "bg-amber-500/20" : "bg-muted"}`}>
              {running ? <Activity className="h-5 w-5 text-green-600 animate-pulse" /> :
               stalled ? <AlertCircle className="h-5 w-5 text-amber-600" /> :
                        <PlayCircle className="h-5 w-5 text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                ระบบตอนนี้
              </div>
              {running && current && (
                <>
                  <div className="text-base font-semibold truncate">
                    🟢 กำลังทำ: {current.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ขั้นตอน: <span className="font-mono">{current.current_step_label ?? current.current_step ?? "—"}</span>
                    {" · "}heartbeat {ago(current.last_heartbeat_at)}
                    {current.progress_pct != null && ` · ${current.progress_pct}%`}
                  </div>
                  {current.current_action_message && (
                    <div className="text-xs mt-1 italic">{current.current_action_message}</div>
                  )}
                </>
              )}
              {stalled && (
                <>
                  <div className="text-base font-semibold">
                    🟡 ไม่มีเล่มกำลังทำ แต่มี {totalToDo} เล่มรออยู่
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ระบบจะ pick up เล่มถัดไปใน ≤ 60 วินาที (cron ทุกนาที) หรือกด "Kick Now" ทันที
                  </div>
                </>
              )}
              {idle && (
                <>
                  <div className="text-base font-semibold">✅ ระบบว่าง</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ไม่มีเล่มในคิว {totalReady > 0 ? `· ${totalReady} เล่มพร้อมเผยแพร่` : ""}
                  </div>
                </>
              )}
            </div>
          </div>
          <Button size="sm" variant={stalled ? "default" : "outline"} onClick={() => kick()} disabled={kicking}>
            {kicking ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            Kick Now
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-2 border-t">
          <Stat label="ต่อไป" value={next?.title ?? "—"} count={live.queued.length} tone="default" />
          <Stat label="รอ retry" value={`${live.waiting.length} เล่ม`} count={live.waiting.length} tone="muted" />
          <Stat label="Auto-fix" value={`${live.auto_fixing.length} เล่ม`} count={live.auto_fixing.length} tone="amber" />
          <Stat label="ติดปัญหา" value={`${totalBlocked} เล่ม`} count={totalBlocked} tone={totalBlocked > 0 ? "red" : "muted"} />
          <Stat label="พร้อมเผยแพร่" value={`${totalReady} เล่ม`} count={totalReady} tone={totalReady > 0 ? "green" : "muted"} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, count, tone }: { label: string; value: string; count: number; tone: "default"|"muted"|"amber"|"red"|"green" }) {
  const color =
    tone === "green" ? "text-green-600" :
    tone === "red"   ? "text-red-600"   :
    tone === "amber" ? "text-amber-600" :
    tone === "muted" ? "text-muted-foreground" :
                       "text-foreground";
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium truncate ${color}`}>
        {count > 0 && tone !== "default" ? <Badge variant="outline" className="mr-1 h-4 px-1 text-[10px]">{count}</Badge> : null}
        {value}
      </div>
    </div>
  );
}
