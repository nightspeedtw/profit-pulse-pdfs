import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Sparkles, RefreshCw, FileSearch } from "lucide-react";
import { fetchAdminData } from "@/lib/adminData";
import { CanvaBookActions } from "@/components/admin/CanvaBookActions";

interface KidsBook {
  id: string;
  title: string;
  status: string;
  listing_status: string;
  pipeline_status: string;
  cover_url: string | null;
  blocker_reason: string | null;
  updated_at: string;
}

interface Run {
  id: string;
  ebook_kids_id: string | null;
  status: string;
  current_step_label: string | null;
  progress_percent: number | null;
  blocker_reason: string | null;
  updated_at: string;
}

interface CostRow { ebook_id: string; total_usd: number; image_usd: number; text_usd: number; n_images: number; n_calls: number }

const PUBLISHABLE_STATUSES = new Set([
  "ready",
  "ready_to_publish",
  "published_candidate",
  "publish_candidate",
]);

export default function KidsLibrary() {
  const [books, setBooks] = useState<KidsBook[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [costs, setCosts] = useState<Record<string, CostRow>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await fetchAdminData<{ books: KidsBook[]; runs: Run[]; costs: CostRow[] }>("kids_library");
      setBooks(data.books ?? []);
      setRuns(data.runs ?? []);
      const map: Record<string, CostRow> = {};
      for (const row of data.costs ?? []) map[row.ebook_id] = row;
      setCosts(map);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 10_000);
    return () => clearInterval(iv);
  }, []);

  const runById = new Map(runs.map((r) => [r.ebook_kids_id, r] as const));

  const publish = async (id: string) => {
    setBusy(true);
    try {
      await fetchAdminData("kids_publish", { ebook_kids_id: id });
      toast({ title: "Published live" });
      load();
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async (id: string) => {
    try {
      await fetchAdminData("kids_unpublish", { ebook_kids_id: id });
      load();
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const candidates = books.filter((b) => b.listing_status === "published_candidate" || PUBLISHABLE_STATUSES.has(b.status));
  const live = books.filter((b) => b.listing_status === "live" && !candidates.includes(b));
  const others = books.filter((b) => !candidates.includes(b) && !live.includes(b));

  const renderCard = (b: KidsBook) => {
    const run = runById.get(b.id);
    const isLive = b.listing_status === "live";
    const isCandidate = b.listing_status === "published_candidate";
    const canPublish = PUBLISHABLE_STATUSES.has(b.status) || isCandidate;
    return (
      <Card key={b.id} className="p-3 border-2 border-foreground space-y-2">
        <div className="flex gap-3">
          {b.cover_url ? (
            <img src={b.cover_url} alt={b.title} className="w-20 h-28 object-cover border-2 border-foreground" />
          ) : (
            <div className="w-20 h-28 bg-muted border-2 border-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-display uppercase text-sm leading-tight line-clamp-2">{b.title}</h3>
            <div className="flex gap-1 mt-1 flex-wrap">
              <Badge variant="outline" className="text-[10px]">{b.status}</Badge>
              {isLive && <Badge className="text-[10px] bg-green-600">live</Badge>}
              {isCandidate && <Badge className="text-[10px] bg-amber-500">publish candidate</Badge>}
              {costs[b.id] && (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  title={`images $${Number(costs[b.id].image_usd).toFixed(3)} · text $${Number(costs[b.id].text_usd).toFixed(3)} · ${costs[b.id].n_images} imgs · ${costs[b.id].n_calls} calls`}
                >
                  ต้นทุน ~${Number(costs[b.id].total_usd).toFixed(2)}
                </Badge>
              )}
            </div>
            {run && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {run.current_step_label ?? run.status} · {run.progress_percent ?? 0}%
              </p>
            )}
            {b.blocker_reason && <p className="text-[11px] text-destructive mt-1 line-clamp-2">⚠ {b.blocker_reason}</p>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to={`/admin/kids/${b.id}/qc`}>
            <Button size="sm" variant="outline" className="gap-1"><FileSearch className="size-3" /> QC Report</Button>
          </Link>
          {isLive ? (
            <Button size="sm" variant="outline" onClick={() => unpublish(b.id)}>Unpublish</Button>
          ) : (
            <Button size="sm" onClick={() => publish(b.id)} disabled={busy || !canPublish}>Publish live</Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl uppercase flex items-center gap-2"><Sparkles className="size-6" /> Kids Library</h1>
          <p className="text-sm text-muted-foreground">{books.length} kids books · isolated backend</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="size-4" /> Refresh</Button>
      </div>

      {err && (
        <div className="border-2 border-destructive p-3 text-sm text-destructive">Load failed: {err}</div>
      )}

      {candidates.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display uppercase text-lg text-amber-600">Publish Candidates · Awaiting Audit ({candidates.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {candidates.map(renderCard)}
          </div>
        </section>
      )}

      {live.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display uppercase text-lg">Live ({live.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {live.map(renderCard)}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display uppercase text-lg text-muted-foreground">In Progress / Drafts ({others.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {others.map(renderCard)}
          </div>
        </section>
      )}

      {books.length === 0 && !err && (
        <div className="border-2 border-dashed border-foreground p-10 text-center text-sm text-muted-foreground">
          No kids books yet. Head to Kids Autopilot and hit "Start one book now".
        </div>
      )}
    </div>
  );
}
