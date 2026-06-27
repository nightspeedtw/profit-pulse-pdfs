import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

type Idea = {
  id: string; title: string; subtitle: string | null; hook: string | null;
  target_buyer: string | null; total_score: number; status: string;
  scores: Record<string, number>; category_id: string | null; created_at: string;
};

const dims = ["urgency", "transformation", "commercial", "evergreen", "emotional", "clarity"] as const;

export default function Ideas() {
  const [items, setItems] = useState<Idea[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("ebook_ideas").select("*").order("total_score", { ascending: false }).limit(100);
    setItems((data ?? []) as Idea[]);
  };
  useEffect(() => { load(); }, []);

  const promote = async (id: string) => {
    setBusy(id);
    try {
      const { data, error } = await supabase.functions.invoke("promote-idea", { body: { idea_id: id } });
      if (error) throw error;
      toast.success("Promoted — outline + content queued.");
      load();
      return data;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    await supabase.from("ebook_ideas").update({ status: "rejected" }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Ideas ]</p>
        <h1 className="font-display text-4xl uppercase">Scored ideas</h1>
      </div>
      {items.length === 0 && (
        <Card className="border-2 border-dashed border-foreground/30">
          <CardContent className="py-10 text-center text-muted-foreground">
            No ideas yet. Click <strong>Generate ideas now</strong> on the dashboard.
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {items.map((i) => (
          <Card key={i.id} className="border-2 border-foreground">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={i.status === "rejected" ? "destructive" : "secondary"}>{i.status}</Badge>
                    <span className="font-mono text-xs">score {i.total_score?.toFixed?.(1) ?? i.total_score}</span>
                  </div>
                  <h3 className="font-display text-xl">{i.title}</h3>
                  {i.subtitle && <p className="text-muted-foreground">{i.subtitle}</p>}
                  {i.hook && <p className="text-sm mt-2 italic">"{i.hook}"</p>}
                  {i.target_buyer && <p className="text-xs text-muted-foreground mt-1">For: {i.target_buyer}</p>}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {i.status === "idea" && (
                    <>
                      <Button size="sm" onClick={() => promote(i.id)} disabled={busy === i.id}>
                        {busy === i.id ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}
                        Promote
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => reject(i.id)}>Reject</Button>
                    </>
                  )}
                  {i.status !== "idea" && i.status !== "rejected" && (
                    <Link to="/admin/pipeline"><Button size="sm" variant="outline">View pipeline</Button></Link>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-6 gap-2 text-xs">
                {dims.map((d) => (
                  <div key={d} className="border-2 border-foreground/20 p-2">
                    <div className="font-mono uppercase text-[10px] text-muted-foreground">{d}</div>
                    <div className="font-bold">{i.scores?.[d] ?? "—"}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
