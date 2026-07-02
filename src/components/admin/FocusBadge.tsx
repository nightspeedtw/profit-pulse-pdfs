import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Focus, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchAdminData } from "@/lib/adminData";

interface QueueEbook {
  id: string;
  title: string | null;
  current_step: string | null;
  progress_pct: number | null;
  queue_position: number | null;
}

interface LiveQueue {
  currently_working_on: QueueEbook[];
  queued: QueueEbook[];
}

export function FocusBadge() {
  const [data, setData] = useState<LiveQueue | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await fetchAdminData<LiveQueue>("live_queue");
        if (cancelled) return;
        setData(d);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const current = data?.currently_working_on?.[0] ?? null;
  const queuedCount = data?.queued?.length ?? 0;

  if (!current) {
    return (
      <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
        <Focus className="size-3" />
        No book in focus
        {queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
      </Badge>
    );
  }

  const pct = Math.max(0, Math.min(100, Math.round(Number(current.progress_pct ?? 0))));
  const title = current.title ?? "Untitled";
  const step = current.current_step ?? "working";

  return (
    <Link
      to={`/admin/ebook/${current.id}/writing`}
      className="inline-flex items-center gap-2 border-2 border-foreground bg-highlight px-2.5 py-1 text-xs font-medium hover:bg-highlight/80 transition-colors max-w-[440px]"
      title={`Focus: ${title}`}
    >
      <Loader2 className="size-3.5 animate-spin shrink-0" />
      <span className="font-mono uppercase tracking-widest text-[10px] shrink-0">Focus</span>
      <span className="truncate">{title}</span>
      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
        · {step} · {pct}%
      </span>
      {queuedCount > 0 && (
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
          · +{queuedCount} queued
        </span>
      )}
    </Link>
  );
}
