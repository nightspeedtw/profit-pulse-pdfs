import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Sparkles, RefreshCw } from "lucide-react";

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

export default function KidsLibrary() {
  const [books, setBooks] = useState<KidsBook[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [costs, setCosts] = useState<Record<string, CostRow>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [b, r, c] = await Promise.all([
      supabase.from("ebooks_kids").select("id,title,status,listing_status,pipeline_status,cover_url,blocker_reason,updated_at").order("updated_at", { ascending: false }).limit(60),
      supabase.from("autopilot_kids_runs").select("id,ebook_kids_id,status,current_step_label,progress_percent,blocker_reason,updated_at").order("updated_at", { ascending: false }).limit(30),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("ebook_costs" as any) as any).select("ebook_id,total_usd,image_usd,text_usd,n_images,n_calls"),
    ]);
    setBooks((b.data ?? []) as KidsBook[]);
    setRuns((r.data ?? []) as Run[]);
    const map: Record<string, CostRow> = {};
    for (const row of (c.data ?? []) as CostRow[]) map[row.ebook_id] = row;
    setCosts(map);
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 10_000);
    return () => clearInterval(iv);
  }, []);

  const runById = new Map(runs.map((r) => [r.ebook_kids_id, r] as const));

  const publish = async (id: string) => {
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("ebooks_kids") as any)
      .update({ listing_status: "live", status: "live" }).eq("id", id);
    setBusy(false);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Published live" }); load(); }
  };

  const unpublish = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ebooks_kids") as any).update({ listing_status: "draft" }).eq("id", id);
    load();
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {books.map((b) => {
          const run = runById.get(b.id);
          const live = b.listing_status === "live";
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
                    {live && <Badge className="text-[10px] bg-green-600">live</Badge>}
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
              <div className="flex gap-2">
                {live ? (
                  <Button size="sm" variant="outline" onClick={() => unpublish(b.id)}>Unpublish</Button>
                ) : (
                  <Button size="sm" onClick={() => publish(b.id)} disabled={busy || b.status !== "ready"}>Publish live</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {books.length === 0 && (
        <div className="border-2 border-dashed border-foreground p-10 text-center text-sm text-muted-foreground">
          No kids books yet. Head to Kids Autopilot and hit "Start one book now".
        </div>
      )}
    </div>
  );
}
