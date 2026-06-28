import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ChevronRight, Loader2, Sparkles, Type, Zap, FolderInput, X, Check, Eye, ChevronDown, Crown, Pencil, Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";

type Idea = {
  id: string; title: string; subtitle: string | null; hook: string | null;
  target_buyer: string | null; total_score: number; status: string;
  scores: Record<string, number>; category_id: string | null; created_at: string;
  raw_title: string | null; raw_subtitle: string | null; raw_hook: string | null; raw_target_buyer: string | null;
  core_pain_point: string | null; deeper_emotional_fear: string | null; transformation_promise: string | null;
  perceived_value_boosters: Record<string, string> | string[] | null;
  why_it_sells: string | null; recommended_action: string | null;
  improvement_round: number; admin_feedback: string | null;
  buyer_identity: string | null; cost_of_doing_nothing: string | null;
  value_proposition: string | null; hard_sell_opening: string | null;
  objection_handling: Record<string, string> | null;
  shopify_meta: Record<string, unknown> | null;
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
  core_pain_point: string; cost_of_doing_nothing?: string;
  transformation_promise: string; product_page_opening: string;
  why_stronger: string;
  buyer_appeal_score: number; premium_score: number;
  hard_sell_strength_score?: number; compliance_risk_score: number; idea_score: number;
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
    final_hard_sell_strength_score?: number;
    final_compliance_risk_score: number; final_idea_score: number;
    status: string; recommended_admin_action: string;
  };
};

// total_score is stored on a 0-100 scale for new ideas. Legacy 0-60 ideas are scaled up.
const to100 = (raw: number) => {
  const n = Number(raw) || 0;
  return n > 60 ? Math.round(n) : Math.round(n / 60 * 100);
};

// Approval thresholds combining buyer-appeal, premium, hard-sell strength, and compliance.
function scoreMeta(score100: number, buyerAppeal?: number, premium?: number, hardSell?: number, compliance?: number) {
  const ba = Number(buyerAppeal ?? score100);
  const pr = Number(premium ?? score100);
  const hs = Number(hardSell ?? score100);
  const cr = Number(compliance ?? 0);
  if (ba >= 85 && pr >= 85 && hs >= 85 && cr <= 3) return { label: "Premium Featured · Ready to Generate", tone: "good" as const, status: "Premium Featured" };
  if (ba >= 80 && pr >= 80 && hs >= 80 && cr <= 4) return { label: "Approved · Ready to Generate", tone: "good" as const, status: "Approved" };
  return { label: "Needs Rewrite · Generate 2 Alternatives", tone: "warn" as const, status: "Needs Rewrite" };
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
  // Milestone 2 — workflow state
  const [headerBusy, setHeaderBusy] = useState(false);
  const [editOpen, setEditOpen] = useState<Idea | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string; subtitle: string; hook: string; target_buyer: string;
    core_pain_point: string; buyer_appeal_score: string; premium_score: string;
    hard_sell_strength_score: string; compliance_risk_score: string; idea_score: string;
  } | null>(null);
  const [rejectOpen, setRejectOpen] = useState<Idea | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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

  const reject = (id: string, reason: string) => run(id, "Rejected.", async () => {
    const { error } = await supabase.from("ebook_ideas").update({
      status: "rejected",
      rejected_reason: reason || null,
      pipeline_status: "rejected",
    }).eq("id", id);
    if (error) throw error;
  });

  // Milestone 2 — generate ONE best concept
  const generateBestConcept = async () => {
    setHeaderBusy(true);
    try {
      const { error } = await supabase.functions.invoke("idea-copywriter", {
        body: { mode: "generate_one_best_concept" },
      });
      if (error) throw error;
      toast.success("Generated one best concept.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setHeaderBusy(false);
    }
  };

  // Milestone 2 — generate EXACTLY TWO alternatives, save as rows
  const generateTwoAlternativeRows = (idea: Idea) =>
    run(idea.id, "Two alternatives saved.", async () => {
      const { error } = await supabase.functions.invoke("idea-copywriter", {
        body: { mode: "generate_two_alternatives", parent_idea_id: idea.id },
      });
      if (error) throw error;
    });

  // Milestone 2 — approve & move to outline_generation, enqueue production_queue
  const approveAndGenerate = (idea: Idea) =>
    run(idea.id, "Approved · queued for outline generation.", async () => {
      const { error: uErr } = await supabase.from("ebook_ideas").update({
        status: "approved",
        selected: true,
        pipeline_status: "outline_generation",
      }).eq("id", idea.id);
      if (uErr) throw uErr;
      const { error: qErr } = await supabase.from("production_queue").insert({
        idea_id: idea.id,
        pipeline_status: "outline_generation",
        priority: 100,
        payload: { idea_id: idea.id },
      });
      if (qErr) throw qErr;
    });

  // Milestone 2 — open Edit Manually dialog
  const openEdit = (idea: Idea) => {
    setEditOpen(idea);
    const s = (idea as unknown as { scores?: Record<string, number> }).scores ?? {};
    setEditDraft({
      title: idea.title ?? "",
      subtitle: idea.subtitle ?? "",
      hook: idea.hook ?? "",
      target_buyer: idea.target_buyer ?? "",
      core_pain_point: idea.core_pain_point ?? "",
      buyer_appeal_score: String(s.buyer_appeal ?? ""),
      premium_score: String(s.premium ?? ""),
      hard_sell_strength_score: String(s.hard_sell ?? ""),
      compliance_risk_score: String(s.compliance_risk ?? ""),
      idea_score: String(s.idea ?? idea.total_score ?? ""),
    });
  };
  const saveEdit = async () => {
    if (!editOpen || !editDraft) return;
    const clamp = (v: string, lo: number, hi: number) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.max(lo, Math.min(hi, Math.round(n)));
    };
    const ba = clamp(editDraft.buyer_appeal_score, 0, 100);
    const pr = clamp(editDraft.premium_score, 0, 100);
    const hs = clamp(editDraft.hard_sell_strength_score, 0, 100);
    const cr = clamp(editDraft.compliance_risk_score, 1, 10);
    const ide = clamp(editDraft.idea_score, 0, 100);
    await run(editOpen.id, "Edits saved.", async () => {
      const { error } = await supabase.from("ebook_ideas").update({
        title: editDraft.title.trim(),
        subtitle: editDraft.subtitle.trim() || null,
        hook: editDraft.hook.trim() || null,
        target_buyer: editDraft.target_buyer.trim() || null,
        core_pain_point: editDraft.core_pain_point.trim() || null,
        buyer_appeal_score: ba,
        premium_score: pr,
        hard_sell_strength_score: hs,
        hard_sell_score: hs,
        compliance_risk_score: cr,
        idea_score: ide,
        total_score: ide ?? editOpen.total_score,
        generation_mode: "manual",
        scores: {
          ...((editOpen as unknown as { scores?: Record<string, number> }).scores ?? {}),
          buyer_appeal: ba ?? undefined,
          premium: pr ?? undefined,
          hard_sell: hs ?? undefined,
          compliance_risk: cr ?? undefined,
          idea: ide ?? undefined,
        },
      }).eq("id", editOpen.id);
      if (error) throw error;
    });
    setEditOpen(null);
    setEditDraft(null);
  };

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

  const runAlternatives = async (idea: Idea) => {
    setAltOpen(idea);
    setAltResult(null);
    setAltLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-alternatives", { body: { idea_id: idea.id } });
      if (error) throw error;
      const res = (data as { result?: AltResult } | null)?.result;
      if (!res) throw new Error("No result");
      setAltResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setAltOpen(null);
    } finally {
      setAltLoading(false);
    }
  };

  const applyAlternative = async (
    idea: Idea,
    alt: Alt,
    winner?: AltResult["ai_recommended_winner"],
  ) => {
    await run(idea.id, "Alternative applied.", async () => {
      const newScores = {
        ...(idea.scores ?? {}),
        buyer_appeal: alt.buyer_appeal_score,
        premium: alt.premium_score,
        compliance_risk: alt.compliance_risk_score,
        idea: alt.idea_score,
      };
      const note = winner
        ? `[alt-winner:${winner.selected_option}] ${winner.status} — ${winner.recommended_admin_action}\nShopify: ${JSON.stringify({
            product_title: winner.shopify_product_title, meta_title: winner.meta_title,
            meta_description: winner.meta_description, url_handle: winner.url_handle, tags: winner.tags,
          })}`
        : `[alt-applied] ${alt.why_stronger}`;
      const { error } = await supabase.from("ebook_ideas").update({
        title: alt.title,
        subtitle: alt.subtitle,
        hook: alt.hook,
        core_pain_point: alt.core_pain_point,
        transformation_promise: alt.transformation_promise,
        scores: newScores,
        total_score: alt.idea_score,
        improvement_round: (idea.improvement_round ?? 0) + 1,
        notes: (idea as unknown as { notes?: string }).notes
          ? `${(idea as unknown as { notes?: string }).notes}\n--\n${note}`
          : note,
      }).eq("id", idea.id);
      if (error) throw error;
    });
    setAltOpen(null);
    setAltResult(null);
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Ideas ]</p>
        <h1 className="font-display text-4xl uppercase">Hard-Sell Ideas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every idea is written first-pass by the <strong>Premium Title &amp; Hard-Sell Copywriter</strong>. Auto-generation only fires when Appeal, Premium, and Hard-Sell all hit <strong>80+</strong>.
          Use <strong>Rewrite</strong> or <strong>Generate 2 Alternatives</strong> when a concept needs lift.
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
          const s = i.scores ?? {};
          const ba = Number(s.buyer_appeal ?? 0);
          const pr = Number(s.premium ?? 0);
          const hs = Number(s.hard_sell ?? 0);
          const cr = Number(s.compliance_risk ?? 0);
          const s100 = ba ? Math.round(Number(s.idea ?? ba)) : to100(i.total_score);
          const meta = scoreMeta(s100, ba || undefined, pr || undefined, hs || undefined, cr || undefined);
          const isBusy = busy === i.id;
          const canPromote = i.status === "idea";
          const isApproved = meta.status === "Approved" || meta.status === "Premium Featured";
          const vb = i.perceived_value_boosters ?? {};
          const vbEntries: [string, string][] = Array.isArray(vb)
            ? vb.filter(Boolean).map((v, idx) => [String(idx + 1), String(v)])
            : Object.entries(vb).filter(([, v]) => v).map(([k, v]) => [k, String(v)]);
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
                      {ba > 0 && <Badge variant="outline" className="font-mono text-[10px]">Appeal {ba}</Badge>}
                      {pr > 0 && <Badge variant="outline" className="font-mono text-[10px]">Premium {pr}</Badge>}
                      {hs > 0 && <Badge variant="outline" className="font-mono text-[10px]">Hard-Sell {hs}</Badge>}
                      {cr > 0 && <Badge variant="outline" className="font-mono text-[10px]">Risk {cr}/10</Badge>}
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
                      {i.buyer_identity && (
                        <div className="border-l-2 border-foreground/40 pl-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Buyer identity</div>
                          <div>{i.buyer_identity}</div>
                        </div>
                      )}
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
                      {i.cost_of_doing_nothing && (
                        <div className="border-l-2 border-destructive/60 pl-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Cost of doing nothing</div>
                          <div>{i.cost_of_doing_nothing}</div>
                        </div>
                      )}
                      {i.transformation_promise && (
                        <div className="border-l-2 border-foreground/40 pl-2 sm:col-span-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Transformation</div>
                          <div>{i.transformation_promise}</div>
                        </div>
                      )}
                      {i.value_proposition && (
                        <div className="border-l-2 border-foreground/40 pl-2 sm:col-span-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Value proposition</div>
                          <div>{i.value_proposition}</div>
                        </div>
                      )}
                      {i.hard_sell_opening && (
                        <div className="border-l-2 border-foreground/40 pl-2 sm:col-span-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Hard-sell opening</div>
                          <div className="italic">{i.hard_sell_opening}</div>
                        </div>
                      )}
                      {i.why_it_sells && (
                        <div className="border-l-2 border-foreground/40 pl-2 sm:col-span-2">
                          <div className="font-mono uppercase text-[10px] text-muted-foreground">Why it sells</div>
                          <div>{i.why_it_sells}</div>
                        </div>
                      )}
                    </div>

                    {vbEntries.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {vbEntries.map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-[10px] font-normal">
                            <span className="font-mono uppercase mr-1 opacity-60">{k.replace("_", " ")}:</span>{v}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {i.objection_handling && Object.values(i.objection_handling).filter(Boolean).length > 0 && (
                      <details className="mt-3 text-xs">
                        <summary className="cursor-pointer font-mono uppercase text-[10px] text-muted-foreground hover:text-foreground">Objection handling</summary>
                        <div className="mt-2 grid sm:grid-cols-2 gap-2">
                          {Object.entries(i.objection_handling).filter(([, v]) => v).map(([k, v]) => (
                            <div key={k} className="border border-foreground/20 p-2">
                              <div className="font-mono uppercase text-[10px] text-muted-foreground">{k.replace(/_/g, " ")}</div>
                              <div>{String(v)}</div>
                            </div>
                          ))}
                        </div>
                      </details>
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
                        {isApproved ? (
                          <Button size="sm" onClick={() => promote(i.id)} disabled={isBusy}>
                            {isBusy ? <Loader2 className="size-4 animate-spin mr-1" /> : <ChevronRight className="size-4 mr-1" />}
                            Approve & Generate
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => approveAndGenerate(i)} disabled={isBusy}
                            title="Below threshold — approve manually?">
                            <Check className="size-4 mr-1" /> Approve Anyway
                          </Button>
                        )}
                        {!isApproved && (
                          <Button size="sm" variant="default" onClick={() => generateTwoAlternativeRows(i)} disabled={isBusy}>
                            <Sparkles className="size-4 mr-1" /> Generate 2 Alternatives
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => openEdit(i)} disabled={isBusy}>
                          <Pencil className="size-4 mr-1" /> Edit Manually
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => { setImproveOpen(i); setFeedback(i.admin_feedback ?? ""); }} disabled={isBusy}>
                          <Sparkles className="size-4 mr-1" /> Rewrite
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => runPremium(i)} disabled={isBusy}>
                          <Crown className="size-4 mr-1" /> Premium Positioning
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => { setRejectOpen(i); setRejectReason(""); }} disabled={isBusy}>
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

      {/* Rewrite dialog */}
      <Dialog open={!!improveOpen} onOpenChange={(o) => !o && setImproveOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rewrite — Pass {(improveOpen?.improvement_round ?? 0) + 1}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Runs the Premium Title &amp; Hard-Sell Copywriter again to lift Appeal / Premium / Hard-Sell scores. Optionally tell it what to fix.
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

      {/* Generate 2 Alternatives dialog */}
      <Dialog open={!!altOpen} onOpenChange={(o) => { if (!o) { setAltOpen(null); setAltResult(null); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="size-5" /> Generate 2 Alternatives</DialogTitle>
          </DialogHeader>
          {altLoading && (
            <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Generating 2 stronger alternatives…
            </div>
          )}
          {altResult && altOpen && (() => {
            const winner = altResult.ai_recommended_winner;
            const winnerAlt = winner.selected_option === "B" ? altResult.alternative_b : altResult.alternative_a;
            const renderAlt = (label: "A" | "B", alt: Alt) => (
              <Card className={`border-2 ${winner.selected_option === label ? "border-foreground bg-foreground/5" : "border-foreground/30"}`}>
                <CardContent className="pt-4 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="font-mono">Option {label}</Badge>
                    {winner.selected_option === label && <Badge className="bg-foreground text-background">AI Pick</Badge>}
                    <Badge variant="secondary" className="font-mono text-[10px]">Appeal {alt.buyer_appeal_score}</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">Premium {alt.premium_score}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">Risk {alt.compliance_risk_score}/10</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">Idea {alt.idea_score}</Badge>
                  </div>
                  <div className="font-display text-base">{alt.title}</div>
                  <div className="text-muted-foreground text-xs">{alt.subtitle}</div>
                  <div className="italic text-xs">"{alt.hook}"</div>
                  <div className="text-xs"><strong>Pain:</strong> {alt.core_pain_point}</div>
                  <div className="text-xs"><strong>Transformation:</strong> {alt.transformation_promise}</div>
                  <div className="text-xs"><strong>Why stronger:</strong> {alt.why_stronger}</div>
                  <div className="text-xs text-muted-foreground"><strong>Page opening:</strong> {alt.product_page_opening}</div>
                  <Button size="sm" className="mt-2 w-full" variant={winner.selected_option === label ? "default" : "outline"}
                    onClick={() => applyAlternative(altOpen, alt, winner.selected_option === label ? winner : undefined)}>
                    <Check className="size-4 mr-1" /> Apply Option {label}
                  </Button>
                </CardContent>
              </Card>
            );
            return (
              <div className="space-y-4">
                <div className="text-xs text-muted-foreground">
                  <strong>Reason current version is weak:</strong> {altResult.reason_current_version_is_not_strong_enough}
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {renderAlt("A", altResult.alternative_a)}
                  {renderAlt("B", altResult.alternative_b)}
                </div>
                <Card className="border-2 border-foreground bg-foreground/5">
                  <CardContent className="pt-4 space-y-2 text-sm">
                    <div className="font-mono uppercase text-xs">AI Recommended Winner — Option {winner.selected_option}</div>
                    <div className="font-display text-lg">{winner.title}</div>
                    <div className="text-muted-foreground text-xs">{winner.subtitle}</div>
                    <div className="italic text-xs">"{winner.hook}"</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge>Appeal {winner.final_buyer_appeal_score}</Badge>
                      <Badge>Premium {winner.final_premium_score}</Badge>
                      <Badge variant="outline">Risk {winner.final_compliance_risk_score}/10</Badge>
                      <Badge variant="outline">Idea {winner.final_idea_score}</Badge>
                      <Badge variant="secondary">{winner.status}</Badge>
                    </div>
                    <div className="mt-2 p-3 bg-background border border-foreground/20 space-y-1 text-xs font-mono">
                      <div className="uppercase opacity-60">Shopify Ready</div>
                      <div><strong>Product title:</strong> {winner.shopify_product_title}</div>
                      <div><strong>Meta title:</strong> {winner.meta_title}</div>
                      <div><strong>Meta description:</strong> {winner.meta_description}</div>
                      <div><strong>URL:</strong> /{winner.url_handle}</div>
                      <div><strong>Tags:</strong> {(winner.tags ?? []).join(", ")}</div>
                    </div>
                    <Button className="w-full" onClick={() => applyAlternative(altOpen, winnerAlt, winner)}>
                      <Check className="size-4 mr-1" /> Apply AI Winner (Option {winner.selected_option})
                    </Button>
                  </CardContent>
                </Card>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => runAlternatives(altOpen)}>
                    <Sparkles className="size-4 mr-1" /> Regenerate Again
                  </Button>
                  <Button variant="ghost" onClick={() => { setAltOpen(null); setAltResult(null); }}>Close</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
