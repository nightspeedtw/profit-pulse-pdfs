import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronRight, Loader2, Sparkles, Type, Zap, FolderInput, X, Check } from "lucide-react";
import { Link } from "react-router-dom";

type Idea = {
  id: string; title: string; subtitle: string | null; hook: string | null;
  target_buyer: string | null; total_score: number; status: string;
  scores: Record<string, number>; category_id: string | null; created_at: string;
};
type Cat = { id: string; name: string };

const dims = ["urgency", "transformation", "commercial", "evergreen", "emotional", "clarity"] as const;

// Raw score is 0-60 (6 dims * 10). Display on 0-100 scale.
const to100 = (raw: number) => Math.round((Number(raw) || 0) / 60 * 100);

function scoreLabel(score100: number) {
  if (score100 >= 85) return { label: "Premium — Featured", tone: "premium" as const };
  if (score100 >= 75) return { label: "Approved for generation", tone: "good" as const };
  if (score100 >= 60) return { label: "Needs improvement", tone: "warn" as const };
  return { label: "Weak — do not generate yet", tone: "bad" as const };
}

const toneClass = {
  premium: "bg-foreground text-background",
  good: "bg-green-600 text-white",
  warn: "bg-yellow-500 text-foreground",
  bad: "bg-destructive text-destructive-foreground",
};

export default function Ideas() {
  const [items, setItems] = useState<Idea[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [{ data: ideas }, { data: c }] = await Promise.all([
      supabase.from("ebook_ideas").select("*").order("total_score", { ascending: false }).limit(100),
      supabase.from("categories").select("id,name").order("name"),
    ]);
    setItems((ideas ?? []) as Idea[]);
    setCats((c ?? []) as Cat[]);
  };
  useEffect(() => { load(); }, []);

  const run = async (id: string, label: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const promote = (id: string) => run(id, "Promoted — generation started.", async () => {
    const { error } = await supabase.functions.invoke("promote-idea", { body: { idea_id: id } });
    if (error) throw error;
  });

  const improve = (id: string, action: "all" | "title" | "hook") =>
    run(id, action === "title" ? "Title rewritten." : action === "hook" ? "Hook improved." : "Idea improved.", async () => {
      const { error } = await supabase.functions.invoke("improve-idea", { body: { idea_id: id, action } });
      if (error) throw error;
    });

  const reject = (id: string) => run(id, "Rejected.", async () => {
    const { error } = await supabase.from("ebook_ideas").update({ status: "rejected" }).eq("id", id);
    if (error) throw error;
  });

  const changeCategory = (id: string, category_id: string) => run(id, "Category changed.", async () => {
    const { error } = await supabase.from("ebook_ideas").update({ category_id }).eq("id", id);
    if (error) throw error;
  });

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Ideas ]</p>
        <h1 className="font-display text-4xl uppercase">Scored ideas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-generation runs only on ideas scoring <strong>75+</strong>. Improve weaker ideas below.
        </p>
      </div>
      {items.length === 0 && (
        <Card className="border-2 border-dashed border-foreground/30">
          <CardContent className="py-10 text-center text-muted-foreground">
            No ideas yet. Click <strong>Generate ideas now</strong> on the dashboard.
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {items.map((i) => {
          const s100 = to100(i.total_score);
          const meta = scoreLabel(s100);
          const isBusy = busy === i.id;
          const canPromote = i.status === "idea";
          return (
            <Card key={i.id} className="border-2 border-foreground">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-2">
                      <Badge variant={i.status === "rejected" ? "destructive" : "secondary"}>{i.status}</Badge>
                      <span className={`font-mono text-xs px-2 py-1 rounded ${toneClass[meta.tone]}`}>
                        Idea Score: {s100} / 100 — {meta.label}
                      </span>
                    </div>
                    <h3 className="font-display text-xl">{i.title}</h3>
                    {i.subtitle && <p className="text-muted-foreground">{i.subtitle}</p>}
                    {i.hook && <p className="text-sm mt-2 italic">"{i.hook}"</p>}
                    {i.target_buyer && <p className="text-xs text-muted-foreground mt-1">For: {i.target_buyer}</p>}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 w-44">
                    {canPromote && (
                      <>
                        {s100 >= 75 ? (
                          <Button size="sm" onClick={() => promote(i.id)} disabled={isBusy}>
                            {isBusy ? <Loader2 className="size-4 animate-spin mr-1" /> : <ChevronRight className="size-4 mr-1" />}
                            Approve & Generate
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => promote(i.id)} disabled={isBusy}
                            title="Score below 75 — generate anyway?">
                            <Check className="size-4 mr-1" /> Approve Anyway
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => improve(i.id, "all")} disabled={isBusy}>
                          <Sparkles className="size-4 mr-1" /> Improve Idea
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => improve(i.id, "title")} disabled={isBusy}>
                          <Type className="size-4 mr-1" /> Rewrite Title
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => improve(i.id, "hook")} disabled={isBusy}>
                          <Zap className="size-4 mr-1" /> Improve Hook
                        </Button>
                        <Select
                          value={i.category_id ?? undefined}
                          onValueChange={(v) => changeCategory(i.id, v)}
                          disabled={isBusy}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <FolderInput className="size-4 mr-1" />
                            <SelectValue placeholder="Change Category" />
                          </SelectTrigger>
                          <SelectContent>
                            {cats.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="destructive" onClick={() => reject(i.id)} disabled={isBusy}>
                          <X className="size-4 mr-1" /> Reject Idea
                        </Button>
                      </>
                    )}
                    {!canPromote && i.status !== "rejected" && (
                      <Link to="/admin/pipeline"><Button size="sm" variant="outline" className="w-full">View pipeline</Button></Link>
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
          );
        })}
      </div>
    </div>
  );
}
