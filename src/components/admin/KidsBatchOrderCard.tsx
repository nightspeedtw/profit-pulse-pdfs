import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Pause, Play, Package } from "lucide-react";

interface BatchOrder {
  id: string;
  target_live_books: number;
  produced_live: number;
  status: "active" | "done" | "paused";
  last_used_lane: string | null;
  updated_at: string;
}

interface ActiveRun {
  ebook_kids_id: string | null;
  current_step_label: string | null;
  progress_percent: number | null;
  title?: string;
}

export function KidsBatchOrderCard() {
  const [order, setOrder] = useState<BatchOrder | null>(null);
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("kids_batch_orders")
      .select("id, target_live_books, produced_live, status, last_used_lane, updated_at")
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setOrder((data as BatchOrder | null) ?? null);

    const { data: run } = await supabase
      .from("autopilot_kids_runs")
      .select("ebook_kids_id, current_step_label, progress_percent")
      .in("status", ["queued", "running"])
      .eq("current_step", "parent_job")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (run?.ebook_kids_id) {
      const { data: eb } = await supabase
        .from("ebooks_kids").select("title").eq("id", run.ebook_kids_id).maybeSingle();
      setActive({ ...(run as ActiveRun), title: (eb as { title?: string } | null)?.title ?? undefined });
    } else {
      setActive(null);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const togglePause = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const next = order.status === "paused" ? "active" : "paused";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("kids_batch_orders") as any)
        .update({ status: next }).eq("id", order.id);
      if (error) throw error;
      toast({ title: next === "paused" ? "หยุดชั่วคราวแล้ว" : "กลับมาผลิตต่อ" });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("kids-batch-producer", { body: { source: "manual" } });
      if (error) throw error;
      toast({ title: "Batch tick queued", description: JSON.stringify(data).slice(0, 160) });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  if (!order) return null;

  const pct = Math.round((order.produced_live / Math.max(1, order.target_live_books)) * 100);

  return (
    <Card className="p-4 border-2 border-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h2 className="font-display text-xl uppercase mb-1 flex items-center gap-2">
            <Package className="size-5" /> คำสั่งผลิตชุด (Batch order)
          </h2>
          <p className="text-sm">
            ผลิตแล้ว <span className="font-bold tabular-nums">{order.produced_live}</span>/
            <span className="tabular-nums">{order.target_live_books}</span> เล่ม
            <span className="mx-2">·</span>
            <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${
              order.status === "active" ? "bg-green-500/20 text-green-700" :
              order.status === "paused" ? "bg-yellow-500/20 text-yellow-700" :
              "bg-muted"
            }`}>{order.status}</span>
          </p>
          <div className="mt-2 h-2 w-full bg-muted rounded overflow-hidden">
            <div className="h-full bg-green-500" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          {active ? (
            <p className="mt-2 text-xs text-muted-foreground">
              กำลังทำ: <span className="font-medium text-foreground">{active.title ?? active.ebook_kids_id?.slice(0, 8) ?? "…"}</span>
              <span className="mx-2">·</span>
              ขั้น: {active.current_step_label ?? "…"}
              <span className="mx-2">·</span>
              {active.progress_percent ?? 0}%
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              ไม่มีงานกำลังผลิต — cron จะเรียก producer ทุก 10 นาที
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="outline" onClick={togglePause} disabled={busy}>
            {order.status === "paused" ? <><Play className="size-3" /> Resume</> : <><Pause className="size-3" /> Pause</>}
          </Button>
          <Button size="sm" variant="secondary" onClick={runNow} disabled={busy || order.status === "paused"}>
            Run tick now
          </Button>
        </div>
      </div>
    </Card>
  );
}
