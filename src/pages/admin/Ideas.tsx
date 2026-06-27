import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ChevronRight, Loader2, Sparkles, Type, Zap, FolderInput, X, Check, Eye, ChevronDown, Crown } from "lucide-react";
import { Link } from "react-router-dom";

type Idea = {
  id: string; title: string; subtitle: string | null; hook: string | null;
  target_buyer: string | null; total_score: number; status: string;
  scores: Record<string, number>; category_id: string | null; created_at: string;
  raw_title: string | null; raw_subtitle: string | null; raw_hook: string | null; raw_target_buyer: string | null;
  core_pain_point: string | null; deeper_emotional_fear: string | null; transformation_promise: string | null;
  perceived_value_boosters: Record<string, string> | null;
  why_it_sells: string | null; recommended_action: string | null;
  improvement_round: number; admin_feedback: string | null;
};
type Cat = { id: string; name: string };

const dims = ["urgency", "transformation", "commercial", "evergreen", "emotional", "clarity"] as const;

// Raw score is 0-60 (6 dims * 10). Display on 0-100 scale.
const to100 = (raw: number) => Math.round((Number(raw) || 0) / 60 * 100);

// New thresholds per product spec.
function scoreMeta(score100: number) {
  if (score100 >= 80) return { label: "Approved · Ready to Generate", tone: "good" as const, status: "Approved" };
  if (score100 >= 70) return { label: "Needs Admin Review", tone: "warn" as const, status: "Needs Admin Review" };
  if (score100 >= 60) return { label: "Needs Admin Review · Improve Again", tone: "warn" as const, status: "Needs Admin Review" };
  return { label: "Weak · Reject or Auto-Improve Level 2", tone: "bad" as const, status: "Reject" };
}

const toneClass = {
  good: "bg-green-600 text-white",
  warn: "bg-yellow-500 text-foreground",
  bad: "bg-destructive text-destructive-foreground",
};

export default function Ideas() {
  const [items, setItems] = useState<Idea[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState<Idea | null>(null);
  const [improveOpen, setImproveOpen] = useState<Idea | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showRawIds, setShowRawIds] = useState<Set<string>>(new Set());
  const [premiumOpen, setPremiumOpen] = useState<Idea | null>(null);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [premiumResult, setPremiumResult] = useState<PremiumResult | null>(null);

  const load = async () => {
    const [{ data: ideas }, { data: c }] = await Promise.all([
      supabase.from("ebook_ideas").select("*").order("total_score", { ascending: false }).limit(100),
      supabase.from("categories").select("id,name").order("name"),
    ]);
    setItems((ideas ?? []) as unknown as Idea[]);
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

  const improve = (id: string, action: "all" | "title" | "hook", admin_feedback?: string) =>
    run(id, action === "title" ? "Title rewritten." : action === "hook" ? "Hook improved." : "Idea improved.", async () => {
      const { error } = await supabase.functions.invoke("improve-idea", { body: { idea_id: id, action, admin_feedback } });
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

  const toggleRaw = (id: string) => {
    setShowRawIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Ideas ]</p>
        <h1 className="font-display text-4xl uppercase">Improved ideas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every raw idea is auto-improved once (Level 1) before review. Auto-generation only fires on ideas scoring <strong>80+</strong>.
          Use <strong>Improve Again</strong> for a stronger second pass.
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
          const meta = scoreMeta(s100);
          const isBusy = busy === i.id;
          const canPromote = i.status === "idea";
          const vb = i.perceived_value_boosters ?? {};
          const showRaw = showRawIds.has(i.id);
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
                      {i.improvement_round > 0 && (
                        <Badge variant="outline" className="font-mono text-[10px]">Improved L{i.improvement_round}</Badge>
                      )}
                      {i.recommended_action && (
                        <Badge variant="outline" className="font-mono text-[10px]">→ {i.recommended_action}</Badge>
                      )}
                    </div>
                    <h3 className="font-display text-xl">{i.title}</h3>
                    {i.subtitle && <p className="text-muted-foreground">{i.subtitle}</p>}
                    {i.hook && <p className="text-sm mt-2 italic">"{i.hook}"</p>}
                    {i.target_buyer && <p className="text-xs text-muted-foreground mt-1"><strong>For:</strong> {i.target_buyer}</p>}

                    <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs">
                      {i.core_pain_point && (
                        <div className="border-l-2 border-foreground/40 pl-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Pain</div>
                          <div>{i.core_pain_point}</div>
                        </div>
                      )}
                      {i.deeper_emotional_fear && (
                        <div className="border-l-2 border-foreground/40 pl-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Fear</div>
                          <div>{i.deeper_emotional_fear}</div>
                        </div>
                      )}
                      {i.transformation_promise && (
                        <div className="border-l-2 border-foreground/40 pl-2 sm:col-span-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Transformation</div>
                          <div>{i.transformation_promise}</div>
                        </div>
                      )}
                      {i.why_it_sells && (
                        <div className="border-l-2 border-foreground/40 pl-2 sm:col-span-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Why it sells</div>
                          <div>{i.why_it_sells}</div>
                        </div>
                      )}
                    </div>

                    {Object.keys(vb).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {Object.entries(vb).filter(([, v]) => v).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-[10px] font-normal">
                            <span className="font-mono uppercase mr-1 opacity-60">{k.replace("_", " ")}:</span>{v}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {i.raw_title && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => toggleRaw(i.id)}
                          className="text-xs font-mono uppercase text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <ChevronDown className={`size-3 transition-transform ${showRaw ? "" : "-rotate-90"}`} />
                          View Raw Idea
                        </button>
                        {showRaw && (
                          <div className="mt-2 p-3 bg-muted/40 border border-foreground/10 text-xs space-y-1">
                            <div><strong>Raw title:</strong> {i.raw_title}</div>
                            {i.raw_subtitle && <div><strong>Raw subtitle:</strong> {i.raw_subtitle}</div>}
                            {i.raw_hook && <div className="italic">"{i.raw_hook}"</div>}
                            {i.raw_target_buyer && <div className="text-muted-foreground">For: {i.raw_target_buyer}</div>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 w-44">
                    {canPromote && (
                      <>
                        {s100 >= 80 ? (
                          <Button size="sm" onClick={() => promote(i.id)} disabled={isBusy}>
                            {isBusy ? <Loader2 className="size-4 animate-spin mr-1" /> : <ChevronRight className="size-4 mr-1" />}
                            Approve & Generate
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => promote(i.id)} disabled={isBusy}
                            title="Score below 80 — generate anyway?">
                            <Check className="size-4 mr-1" /> Approve Anyway
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => { setImproveOpen(i); setFeedback(i.admin_feedback ?? ""); }} disabled={isBusy}>
                          <Sparkles className="size-4 mr-1" /> Improve Again
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => reject(i.id)} disabled={isBusy}>
                          <X className="size-4 mr-1" /> Reject
                        </Button>
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">More actions</summary>
                          <div className="flex flex-col gap-2 mt-2">
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
                            <Button size="sm" variant="ghost" onClick={() => setRawOpen(i)} disabled={isBusy}>
                              <Eye className="size-4 mr-1" /> Raw Details
                            </Button>
                          </div>
                        </details>
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

      {/* Improve Again dialog */}
      <Dialog open={!!improveOpen} onOpenChange={(o) => !o && setImproveOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Improve Again — Level {(improveOpen?.improvement_round ?? 0) + 1}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Runs a stronger second-pass prompt to lift the buyer-appeal score. Optionally tell the AI what to focus on.
            </p>
            <Textarea
              placeholder="Optional admin feedback — e.g. 'Title too generic', 'Buyer is too broad', 'Make the pain more urgent'…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImproveOpen(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                const id = improveOpen?.id; if (!id) return;
                const fb = feedback.trim();
                setImproveOpen(null);
                await improve(id, "all", fb || undefined);
                setFeedback("");
              }}
            >
              <Sparkles className="size-4 mr-1" /> Run Improvement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raw details dialog */}
      <Dialog open={!!rawOpen} onOpenChange={(o) => !o && setRawOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Raw Idea (pre-improvement)</DialogTitle></DialogHeader>
          {rawOpen && (
            <div className="space-y-2 text-sm">
              <div><strong>Title:</strong> {rawOpen.raw_title ?? "—"}</div>
              <div><strong>Subtitle:</strong> {rawOpen.raw_subtitle ?? "—"}</div>
              <div><strong>Hook:</strong> {rawOpen.raw_hook ?? "—"}</div>
              <div><strong>Target buyer:</strong> {rawOpen.raw_target_buyer ?? "—"}</div>
              {rawOpen.admin_feedback && (
                <div className="pt-2 border-t mt-2">
                  <strong>Last admin feedback:</strong>
                  <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{rawOpen.admin_feedback}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
