// Production — single table replacing Ideas + Pipeline.
// Exactly 4 row actions: View, Resume, Fix, Reject.
// Advanced/manual controls live on the job detail page (EbookReview).
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAdminData } from "@/lib/adminData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, RefreshCw, Wrench, XCircle, Loader2, RotateCw, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge, resolveEbookBadge, type EbookBadgeKind } from "@/components/admin/StatusBadge";
import { WorksheetOverflowReview } from "@/components/admin/WorksheetOverflowReview";

type Ebook = {
  id: string; title: string;
  run_id?: string | null; ebook_id?: string | null; idea_id?: string | null;
  source?: string | null; run_status?: string | null;
  current_step?: string | null; current_step_label?: string | null;
  current_action_message?: string | null; current_subtask?: string | null;
  progress_percent?: number | null; pause_requested?: boolean | null;
  autopilot_state: string | null; autopilot_mode: string | null;
  shopify_status: string | null;
  manuscript_qc_status: string | null; pdf_status: string | null;
  word_count: number | null;
  final_quality_score: number | null;
  needs_review_reason: string | null;
  updated_at: string;
  worksheet_table_overflow_score: number | null;
  worksheet_previews_json: any;
  blocker_class?: string | null;
  blocker_reason?: string | null;
  next_retry_at?: string | null;
};

type FilterKey =
  | "all" | "running" | "auto_fixing" | "waiting_quota"
  | "needs_attention" | "draft_uploaded" | "published" | "failed";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All jobs",
  running: "Running",
  auto_fixing: "Auto-Fixing",
  waiting_quota: "Waiting for Quota",
  needs_attention: "Needs Attention",
  draft_uploaded: "Draft Uploaded",
  published: "Published",
  failed: "Failed / Rejected",
};

export default function Production() {
  const [ebooks, setEbooks] = useState<Ebook[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") as FilterKey) || "all";

  const worksheetFailures = useMemo(
    () => {
      const seen = new Set<string>();
      return ebooks.filter((e) => {
        const ebookId = e.ebook_id ?? e.id;
        if (seen.has(ebookId)) return false;
        const failed =
          (e.worksheet_table_overflow_score != null && e.worksheet_table_overflow_score < 100) ||
          (e.worksheet_previews_json?.entries?.length ?? 0) > 0;
        if (failed) seen.add(ebookId);
        return failed;
      });
    },
    [ebooks],
  );
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function load() {
    try {
      const { ebooks } = await fetchAdminData<{ ebooks: Ebook[] }>("production");
      setEbooks(ebooks ?? []);
    } catch (err) {
      console.error("[Production] load failed", err);
    }
  }
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ebooks.filter((e) => {
      const badge = resolveJobBadge(e);
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
    const ebookId = e.ebook_id ?? e.id;
    if (!ebookId) return toast.error("This run is not linked to an ebook yet.");
    setBusy(e.id);
    try {
      const { error } = await supabase.functions.invoke("autopilot-pipeline", {
        body: { ebook_id: ebookId, mode: e.autopilot_mode ?? "safe" },
      });
      if (error) throw error;
      toast.success("Resumed");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(null); }
  }

  async function fix(e: Ebook) {
    const ebookId = e.ebook_id ?? e.id;
    if (!ebookId) return toast.error("This run is not linked to an ebook yet.");
    setBusy(e.id);
    try {
      const { error } = await supabase.functions.invoke("qc-fix", { body: { ebook_id: ebookId } });
      if (error) throw error;
      toast.success("Auto-fix queued");
      load();
    } catch (err) {
      // Fallback: just resume the pipeline (qc-fix may not be wired for every stage).
      try {
        await supabase.functions.invoke("autopilot-pipeline", {
          body: { ebook_id: ebookId, mode: e.autopilot_mode ?? "safe", force_rewrite: true },
        });
        toast.success("Rewrite queued");
        load();
      } catch (err2) {
        toast.error(err2 instanceof Error ? err2.message : "Failed");
      }
    } finally { setBusy(null); }
  }

  async function reject(e: Ebook) {
    const ebookId = e.ebook_id ?? e.id;
    if (!ebookId) return toast.error("This run is not linked to an ebook yet.");
    if (!confirm(`Reject "${e.title}"? This stops the pipeline for this job.`)) return;
    setBusy(e.id);
    const { error } = await supabase.from("ebooks")
      .update({ autopilot_state: "rejected", needs_review_reason: "Manually rejected by admin." })
      .eq("id", ebookId);
    setBusy(null);
    if (error) toast.error(error.message);
    else { toast.success("Rejected"); load(); }
  }

  const counts: Record<FilterKey, number> = {
    all: ebooks.length,
    running: ebooks.filter((e) => {
      const b = resolveJobBadge(e); return b === "writing" || b === "queued";
    }).length,
    needs_attention: ebooks.filter((e) => {
      const b = resolveJobBadge(e); return b === "needs_review" || b === "qc_failed";
    }).length,
    draft_uploaded: ebooks.filter((e) => resolveJobBadge(e) === "draft_uploaded").length,
    published: ebooks.filter((e) => resolveJobBadge(e) === "published").length,
    failed: ebooks.filter((e) => {
      const b = resolveJobBadge(e); return b === "failed" || b === "rejected";
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
                  const badge = resolveJobBadge(e);
                  const canResume = (["failed", "qc_failed", "needs_review"] as EbookBadgeKind[]).includes(badge);
                  const canFix = badge === "qc_failed" || badge === "needs_review";
                  const canReject = badge !== "published" && badge !== "rejected";
                  const ebookId = e.ebook_id ?? e.id;
                  return (
                    <tr key={e.id} className="border-b border-foreground/10 align-top hover:bg-muted/30">
                      <td className="p-3 max-w-[360px]">
                        <Link to={`/admin/ebook/${ebookId}`} className="font-medium hover:underline line-clamp-2">
                          {e.title || "Untitled"}
                        </Link>
                        {e.run_id && (
                          <p className="text-[10px] font-mono text-muted-foreground mt-1">
                            run {e.run_id.slice(0, 8)} · {e.run_status ?? "unknown"}
                            {typeof e.progress_percent === "number" && ` · ${e.progress_percent}%`}
                          </p>
                        )}
                        {e.needs_review_reason && (
                          <p className="text-[11px] text-orange-700 mt-1 line-clamp-2">⚠ {e.needs_review_reason}</p>
                        )}
                      </td>
                      <td className="p-3"><StatusBadge kind={badge} /></td>
                      <td className="p-3 text-xs font-mono text-muted-foreground">
                        {e.current_step_label ?? prettyStep(e.current_step ?? e.autopilot_state)}
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
                          <Link to={`/admin/ebook/${ebookId}`}>
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

      {worksheetFailures.length > 0 && (
        <Card className="border-2 border-red-500/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono uppercase text-red-800">
              Worksheet overflow — {worksheetFailures.length} job{worksheetFailures.length === 1 ? "" : "s"} need review
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These ebooks failed the automated table-overflow / cropping check. Preview each fix
              before the pipeline uploads the PDF to Shopify.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {worksheetFailures.map((e) => {
              const ebookId = e.ebook_id ?? e.id;
              const isOpen = expanded.has(e.id);
              const count = e.worksheet_previews_json?.entries?.length ?? 0;
              return (
                <div key={e.id} className="border border-foreground/20 rounded">
                  <button
                    onClick={() => toggle(e.id)}
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{e.title || "Untitled"}</p>
                        <p className="text-[11px] font-mono text-muted-foreground">
                          overflow score {e.worksheet_table_overflow_score ?? "—"}/100
                          {count > 0 && ` · ${count} preview${count === 1 ? "" : "s"} cached`}
                        </p>
                      </div>
                    </div>
                    <Link to={`/admin/ebook/${ebookId}/pdf`} onClick={(ev) => ev.stopPropagation()}
                      className="text-xs underline text-muted-foreground shrink-0 ml-3">
                      Open PDF page →
                    </Link>
                  </button>
                  {isOpen && (
                    <div className="p-3 border-t border-foreground/10 bg-muted/10">
                      <WorksheetOverflowReview
                        ebookId={ebookId}
                        overflowScore={e.worksheet_table_overflow_score}
                        initialPreviews={e.worksheet_previews_json ?? null}
                        compact
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

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

function resolveJobBadge(e: Ebook): EbookBadgeKind {
  const status = e.run_status ?? "";
  if (e.pause_requested) return "paused";
  if (["starting", "running", "auto_fixing"].includes(status)) return "writing";
  if (status === "needs_admin") return (e.current_step ?? "").includes("qc") ? "qc_failed" : "needs_review";
  if (status === "failed") return "failed";
  return resolveEbookBadge(e);
}
