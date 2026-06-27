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

type ValueBoosters = { checklist?: string; template?: string; workbook?: string; calculator?: string; action_plan?: string };
type PremiumOption = {
  premium_title: string; premium_subtitle: string; target_buyer: string;
  core_pain_point: string; premium_transformation_promise: string;
  perceived_value_boosters: ValueBoosters; primary_hook: string;
  buyer_appeal_score: number; premium_score: number; why_it_feels_premium: string;
};
type PremiumResult = {
  premium_diagnosis: { why_ordinary: string; what_would_make_premium: string; best_buyer_emotion: string };
  options: PremiumOption[];
  best_final_choice: {
    premium_title: string; premium_subtitle: string; primary_hook: string;
    product_page_opening: string; recommended_category: string; recommended_price: string;
    buyer_appeal_score: number; premium_score: number;
    shopify_ready: { product_title: string; meta_title: string; meta_description: string; url_handle: string; tags: string[] };
  };
};

type Alt = {
  title: string; subtitle: string; hook: string;
  core_pain_point: string; transformation_promise: string; product_page_opening: string;
  why_stronger: string;
  buyer_appeal_score: number; premium_score: number; compliance_risk_score: number; idea_score: number;
};
type AltResult = {
  previous_title: string;
  reason_current_version_is_not_strong_enough: string;
  alternative_a: Alt;
  alternative_b: Alt;
  ai_recommended_winner: {
    selected_option: "A" | "B";
    title: string; subtitle: string; hook: string; product_page_opening: string;
    shopify_product_title: string; meta_title: string; meta_description: string;
    url_handle: string; tags: string[];
    final_buyer_appeal_score: number; final_premium_score: number;
    final_compliance_risk_score: number; final_idea_score: number;
    status: string; recommended_admin_action: string;
  };
};

// total_score is stored on a 0-100 scale for new ideas. Legacy 0-60 ideas are scaled up.
const to100 = (raw: number) => {
  const n = Number(raw) || 0;
  return n > 60 ? Math.round(n) : Math.round(n / 60 * 100);
};

// Approval thresholds combining buyer-appeal, premium, and compliance-risk scores.
function scoreMeta(score100: number, buyerAppeal?: number, premium?: number, compliance?: number) {
  const ba = Number(buyerAppeal ?? score100);
  const pr = Number(premium ?? score100);
  const cr = Number(compliance ?? 0);
  if (ba >= 85 && pr >= 85 && cr <= 3) return { label: "Premium Featured · Ready to Generate", tone: "good" as const, status: "Premium Featured" };
  if (ba >= 80 && pr >= 80 && cr <= 4) return { label: "Approved · Ready to Generate", tone: "good" as const, status: "Approved" };
  if (ba >= 70 || pr >= 70) return { label: "Needs Admin Review · Generate 2 Alternatives", tone: "warn" as const, status: "Needs Admin Review" };
  return { label: "Needs Regeneration", tone: "bad" as const, status: "Needs Regeneration" };
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
  const [altOpen, setAltOpen] = useState<Idea | null>(null);
  const [altLoading, setAltLoading] = useState(false);
  const [altResult, setAltResult] = useState<AltResult | null>(null);

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

  const runPremium = async (idea: Idea) => {
    setPremiumOpen(idea);
    setPremiumResult(null);
    setPremiumLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("premium-positioning", { body: { idea_id: idea.id } });
      if (error) throw error;
      const res = (data as { result?: PremiumResult } | null)?.result;
      if (!res) throw new Error("No result");
      setPremiumResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setPremiumOpen(null);
    } finally {
      setPremiumLoading(false);
    }
  };

  const applyPremiumOption = async (idea: Idea, opt: PremiumOption) => {
    await run(idea.id, "Premium positioning applied.", async () => {
      const { error } = await supabase.from("ebook_ideas").update({
        title: opt.premium_title,
        subtitle: opt.premium_subtitle,
        target_buyer: opt.target_buyer,
        hook: opt.primary_hook,
        core_pain_point: opt.core_pain_point,
        transformation_promise: opt.premium_transformation_promise,
        perceived_value_boosters: opt.perceived_value_boosters ?? {},
      }).eq("id", idea.id);
      if (error) throw error;
    });
    setPremiumOpen(null);
    setPremiumResult(null);
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
                        <Button size="sm" variant="outline" onClick={() => runPremium(i)} disabled={isBusy}>
                          <Crown className="size-4 mr-1" /> Premium Positioning
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

      {/* Premium Positioning dialog */}
      <Dialog open={!!premiumOpen} onOpenChange={(o) => { if (!o) { setPremiumOpen(null); setPremiumResult(null); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Crown className="size-5" /> Premium Positioning</DialogTitle>
          </DialogHeader>
          {premiumLoading && (
            <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Generating 10 premium variants…
            </div>
          )}
          {premiumResult && premiumOpen && (
            <div className="space-y-6">
              <Card className="border-2 border-foreground/30">
                <CardContent className="pt-4 space-y-2 text-sm">
                  <div className="font-mono uppercase text-xs">Premium Diagnosis</div>
                  <div><strong>Why ordinary:</strong> {premiumResult.premium_diagnosis.why_ordinary}</div>
                  <div><strong>What would make it premium:</strong> {premiumResult.premium_diagnosis.what_would_make_premium}</div>
                  <div><strong>Best buyer emotion:</strong> {premiumResult.premium_diagnosis.best_buyer_emotion}</div>
                </CardContent>
              </Card>

              <div>
                <h3 className="font-display text-lg mb-2">Best Final Choice</h3>
                <Card className="border-2 border-foreground bg-foreground/5">
                  <CardContent className="pt-4 space-y-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-foreground text-background">Buyer Appeal {premiumResult.best_final_choice.buyer_appeal_score}</Badge>
                      <Badge className="bg-foreground text-background">Premium {premiumResult.best_final_choice.premium_score}</Badge>
                      <Badge variant="outline">Price: {premiumResult.best_final_choice.recommended_price}</Badge>
                    </div>
                    <div className="font-display text-xl">{premiumResult.best_final_choice.premium_title}</div>
                    <div className="text-muted-foreground">{premiumResult.best_final_choice.premium_subtitle}</div>
                    <div className="italic">"{premiumResult.best_final_choice.primary_hook}"</div>
                    <div className="text-xs"><strong>Product page opening:</strong> {premiumResult.best_final_choice.product_page_opening}</div>
                    <div className="mt-3 p-3 bg-background border border-foreground/20 space-y-1 text-xs font-mono">
                      <div className="uppercase opacity-60">Shopify Ready</div>
                      <div><strong>Product title:</strong> {premiumResult.best_final_choice.shopify_ready.product_title}</div>
                      <div><strong>Meta title:</strong> {premiumResult.best_final_choice.shopify_ready.meta_title}</div>
                      <div><strong>Meta description:</strong> {premiumResult.best_final_choice.shopify_ready.meta_description}</div>
                      <div><strong>URL:</strong> /{premiumResult.best_final_choice.shopify_ready.url_handle}</div>
                      <div><strong>Tags:</strong> {(premiumResult.best_final_choice.shopify_ready.tags ?? []).join(", ")}</div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => applyPremiumOption(premiumOpen, {
                        premium_title: premiumResult.best_final_choice.premium_title,
                        premium_subtitle: premiumResult.best_final_choice.premium_subtitle,
                        target_buyer: premiumOpen.target_buyer ?? "",
                        core_pain_point: premiumOpen.core_pain_point ?? "",
                        premium_transformation_promise: premiumOpen.transformation_promise ?? "",
                        perceived_value_boosters: (premiumOpen.perceived_value_boosters ?? {}) as ValueBoosters,
                        primary_hook: premiumResult.best_final_choice.primary_hook,
                        buyer_appeal_score: premiumResult.best_final_choice.buyer_appeal_score,
                        premium_score: premiumResult.best_final_choice.premium_score,
                        why_it_feels_premium: "",
                      })}
                    >
                      <Check className="size-4 mr-1" /> Apply Best Choice to Idea
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div>
                <h3 className="font-display text-lg mb-2">10 Premium Options</h3>
                <div className="space-y-3">
                  {premiumResult.options.map((opt, idx) => {
                    const vb = opt.perceived_value_boosters ?? {};
                    return (
                      <Card key={idx} className="border border-foreground/30">
                        <CardContent className="pt-4 space-y-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-mono text-[10px]">Option {idx + 1}</Badge>
                            <Badge variant="secondary" className="font-mono text-[10px]">Appeal {opt.buyer_appeal_score}</Badge>
                            <Badge variant="secondary" className="font-mono text-[10px]">Premium {opt.premium_score}</Badge>
                          </div>
                          <div className="font-display text-base">{opt.premium_title}</div>
                          <div className="text-muted-foreground text-xs">{opt.premium_subtitle}</div>
                          <div className="italic text-xs">"{opt.primary_hook}"</div>
                          <div className="text-xs"><strong>For:</strong> {opt.target_buyer}</div>
                          <div className="text-xs"><strong>Pain:</strong> {opt.core_pain_point}</div>
                          <div className="text-xs"><strong>Transformation:</strong> {opt.premium_transformation_promise}</div>
                          <div className="text-xs"><strong>Why premium:</strong> {opt.why_it_feels_premium}</div>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(vb).filter(([, v]) => v).map(([k, v]) => (
                              <Badge key={k} variant="outline" className="text-[10px] font-normal">
                                <span className="font-mono uppercase mr-1 opacity-60">{k.replace("_", " ")}:</span>{v}
                              </Badge>
                            ))}
                          </div>
                          <Button size="sm" variant="outline" className="mt-2" onClick={() => applyPremiumOption(premiumOpen, opt)}>
                            <Check className="size-4 mr-1" /> Apply This Option
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
