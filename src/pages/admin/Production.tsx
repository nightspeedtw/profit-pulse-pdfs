// Production — single table replacing Ideas + Pipeline.
// Exactly 4 row actions: View, Resume, Fix, Reject.
// Advanced/manual controls live on the job detail page (EbookReview).
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, RefreshCw, Wrench, XCircle, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge, resolveEbookBadge, type EbookBadgeKind } from "@/components/admin/StatusBadge";

type Ebook = {
  id: string; title: string;
  autopilot_state: string | null; autopilot_mode: string | null;
  shopify_status: string | null;
  manuscript_qc_status: string | null; pdf_status: string | null;
  word_count: number | null;
  final_quality_score: number | null;
  needs_review_reason: string | null;
  updated_at: string;
};

type FilterKey = "all" | "running" | "needs_attention" | "draft_uploaded" | "published" | "failed";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All jobs",
  running: "Running",
  needs_attention: "Needs Attention",
  draft_uploaded: "Draft Uploaded",
  published: "Published",
  failed: "Failed / Rejected",
};

export default function Production() {
  const [ebooks, setEbooks] = useState<Ebook[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") as FilterKey) || "all";

  async function load() {
    const { data } = await supabase.from("ebooks")
      .select("id,title,autopilot_state,autopilot_mode,shopify_status,manuscript_qc_status,pdf_status,word_count,final_quality_score,needs_review_reason,updated_at")
      .order("updated_at", { ascending: false }).limit(200);
    setEbooks((data ?? []) as Ebook[]);
  }
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ebooks.filter((e) => {
      const badge = resolveEbookBadge(e);
      if (filter === "running" && badge !== "writing" && badge !== "queued") return false;
      if (filter === "needs_attention" && badge !== "needs_review" && badge !== "qc_failed") return false;
      if (filter === "draft_uploaded" && badge !== "draft_uploaded") return false;
      if (filter === "published" && badge !== "published") return false;
      if (filter === "failed" && badge !== "failed" && badge !== "rejected") return false;
      if (term && !(e.title ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [ebooks, filter, search]);

  async function resume(e: Ebook) {
    setBusy(e.id);
    try {
      const { error } = await supabase.functions.invoke("autopilot-pipeline", {
        body: { ebook_id: e.id, mode: e.autopilot_mode ?? "safe" },
      });
      if (error) throw error;
      toast.success("Resumed");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(null); }
  }

  async function fix(e: Ebook) {
    setBusy(e.id);
    try {
      const { error } = await supabase.functions.invoke("qc-fix", { body: { ebook_id: e.id } });
      if (error) throw error;
      toast.success("Auto-fix queued");
      load();
    } catch (err) {
      // Fallback: just resume the pipeline (qc-fix may not be wired for every stage).
      try {
        await supabase.functions.invoke("autopilot-pipeline", {
          body: { ebook_id: e.id, mode: e.autopilot_mode ?? "safe", force_rewrite: true },
        });
        toast.success("Rewrite queued");
        load();
      } catch (err2) {
        toast.error(err2 instanceof Error ? err2.message : "Failed");
      }
    } finally { setBusy(null); }
  }

  async function reject(e: Ebook) {
    if (!confirm(`Reject "${e.title}"? This stops the pipeline for this job.`)) return;
    setBusy(e.id);
    const { error } = await supabase.from("ebooks")
      .update({ autopilot_state: "rejected", needs_review_reason: "Manually rejected by admin." })
      .eq("id", e.id);
    setBusy(null);
    if (error) toast.error(error.message);
    else { toast.success("Rejected"); load(); }
  }

  const counts: Record<FilterKey, number> = {
    all: ebooks.length,
    running: ebooks.filter((e) => resolveEbookBadge(e) === "writing").length,
    needs_attention: ebooks.filter((e) => {
      const b = resolveEbookBadge(e); return b === "needs_review" || b === "qc_failed";
    }).length,
    draft_uploaded: ebooks.filter((e) => resolveEbookBadge(e) === "draft_uploaded").length,
    published: ebooks.filter((e) => resolveEbookBadge(e) === "published").length,
    failed: ebooks.filter((e) => {
      const b = resolveEbookBadge(e); return b === "failed" || b === "rejected";
    }).length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">[ Production ]</p>
          <h1 className="font-display text-4xl uppercase">Ebook jobs</h1>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Search by title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select value={filter} onValueChange={(v) => setParams(v === "all" ? {} : { filter: v })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => (
                <SelectItem key={k} value={k}>{FILTER_LABEL[k]} ({counts[k]})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={load} title="Refresh"><RotateCw className="size-4" /></Button>
        </div>
      </div>

      <Card className="border-2 border-foreground">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono uppercase">
            {FILTER_LABEL[filter]} — {filtered.length} job{filtered.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b-2 border-foreground/20">
                <tr className="text-left font-mono uppercase text-[10px] tracking-wide">
                  <th className="p-3">Title</th>
                  <th className="p-3 w-32">Status</th>
                  <th className="p-3 w-36">Current step</th>
                  <th className="p-3 w-24 text-right">Words</th>
                  <th className="p-3 w-20 text-right">QC</th>
                  <th className="p-3 w-32">Shopify</th>
                  <th className="p-3 w-40 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                    No jobs match this view.
                  </td></tr>
                )}
                {filtered.map((e) => {
                  const badge = resolveEbookBadge(e);
                  const canResume = (["failed", "qc_failed", "needs_review"] as EbookBadgeKind[]).includes(badge);
                  const canFix = badge === "qc_failed" || badge === "needs_review";
                  const canReject = badge !== "published" && badge !== "rejected";
                  return (
                    <tr key={e.id} className="border-b border-foreground/10 align-top hover:bg-muted/30">
                      <td className="p-3 max-w-[360px]">
                        <Link to={`/admin/ebook/${e.id}`} className="font-medium hover:underline line-clamp-2">
                          {e.title || "Untitled"}
                        </Link>
                        {e.needs_review_reason && (
                          <p className="text-[11px] text-orange-700 mt-1 line-clamp-2">⚠ {e.needs_review_reason}</p>
                        )}
                      </td>
                      <td className="p-3"><StatusBadge kind={badge} /></td>
                      <td className="p-3 text-xs font-mono text-muted-foreground">
                        {prettyStep(e.autopilot_state)}
                      </td>
                      <td className="p-3 text-xs font-mono text-right">{(e.word_count ?? 0).toLocaleString()}</td>
                      <td className="p-3 text-xs font-mono text-right">
                        <span className={e.final_quality_score && e.final_quality_score >= 85 ? "text-emerald-700 font-bold" : "text-muted-foreground"}>
                          {e.final_quality_score ?? "—"}
                        </span>
                      </td>
                      <td className="p-3 text-xs font-mono text-muted-foreground">
                        {e.shopify_status ?? "—"}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <Link to={`/admin/ebook/${e.id}`}>
                            <Button size="sm" variant="ghost" title="View"><Eye className="size-3" /></Button>
                          </Link>
                          {canResume && (
                            <Button size="sm" variant="ghost" title="Resume" disabled={busy === e.id} onClick={() => resume(e)}>
                              {busy === e.id ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                            </Button>
                          )}
                          {canFix && (
                            <Button size="sm" variant="ghost" title="Auto-fix / rewrite" disabled={busy === e.id} onClick={() => fix(e)}>
                              <Wrench className="size-3" />
                            </Button>
                          )}
                          {canReject && (
                            <Button size="sm" variant="ghost" title="Reject" disabled={busy === e.id} onClick={() => reject(e)}>
                              <XCircle className="size-3 text-red-700" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Need to rewrite, regenerate, view raw JSON, or run premium positioning? Open the job detail page (View).
        Advanced actions live there, not on this list.
      </p>
    </div>
  );
}

function prettyStep(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.startsWith("writing")) return s;
  return s.replace(/_/g, " ");
}
