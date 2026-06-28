// Milestone 3 — Ebook writing progress dashboard.
// Shows approved idea, outline preview, chapter list with QC scores + word counts,
// and provides controls: Generate Outline, Improve Outline, Start Writing,
// Rewrite Chapter, Approve Manuscript, Reject.
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Play, FileText, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

type Ebook = any;
type Chapter = {
  id: string; chapter_index: number; title: string; brief: string | null;
  content: string | null; word_count: number | null; pipeline_status: string;
  qc_status: string | null; rewrite_count: number; qc_scores: any;
  rejection_reason: string | null;
};

const TARGET_WORDS = 18000;

function ScoreBadge({ label, value }: { label: string; value: number | undefined | null }) {
  const v = Number(value ?? 0);
  const color = v >= 80 ? "bg-green-500/10 text-green-700 border-green-500/30"
    : v >= 60 ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30"
    : "bg-red-500/10 text-red-700 border-red-500/30";
  return <Badge variant="outline" className={`${color} font-mono text-xs`}>{label} {v}</Badge>;
}

export default function EbookWriting() {
  const { id } = useParams();
  const [ebook, setEbook] = useState<Ebook | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function load() {
    if (!id) return;
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from("ebooks").select("*").eq("id", id).maybeSingle(),
      supabase.from("ebook_chapters").select("*").eq("ebook_id", id).order("chapter_index"),
    ]);
    setEbook(e); setChapters((c ?? []) as Chapter[]);
  }

  useEffect(() => { load(); }, [id]);

  // Poll while writing
  useEffect(() => {
    if (!ebook) return;
    const active = ["outline_generating", "writing"].includes(ebook.writing_status);
    if (!active) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [ebook?.writing_status]);

  async function call(fn: string, body: any, label: string) {
    setBusy(label);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: `${label} started`, description: typeof data === "object" ? JSON.stringify(data).slice(0, 120) : "" });
      await load();
    } catch (e: any) {
      toast({ title: `${label} failed`, description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const outline = ebook?.outline_json as any;
  const outlineReady = outline?.chapters?.length > 0;
  const totalWords = ebook?.total_word_count ?? ebook?.word_count ?? 0;
  const wordProgress = Math.min(100, Math.round((totalWords / TARGET_WORDS) * 100));
  const passedCount = chapters.filter((c) => c.qc_status === "passed").length;
  const chapterTotal = outline?.chapters?.length ?? chapters.length;
  const allPassed = chapterTotal > 0 && passedCount === chapterTotal;

  const outlineScores = ebook?.outline_qc as any;

  if (!ebook) return <div className="p-6"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ Writing Engine ]</p>
          <h1 className="font-display text-3xl uppercase leading-tight">{ebook.title}</h1>
          {ebook.subtitle && <p className="text-muted-foreground mt-1">{ebook.subtitle}</p>}
          <div className="flex gap-2 mt-3 flex-wrap">
            <Badge variant="outline">writing_status: {ebook.writing_status}</Badge>
            <Badge variant="outline">pipeline: {ebook.pipeline_status}</Badge>
            {ebook.qc_status && <Badge variant="outline">qc: {ebook.qc_status}</Badge>}
            {ebook.outline_rewrite_count > 0 && <Badge variant="outline">outline rewrites: {ebook.outline_rewrite_count}</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" /></Button>
      </div>

      {ebook.rejection_reason && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm"><strong>Reason:</strong> {ebook.rejection_reason}</div>
          </CardContent>
        </Card>
      )}

      {/* Idea card */}
      <Card>
        <CardContent className="p-4 space-y-1 text-sm">
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Approved Idea</p>
          <p><strong>Target buyer:</strong> {ebook.target_buyer}</p>
          <p><strong>Hook:</strong> {ebook.hook}</p>
        </CardContent>
      </Card>

      {/* Outline section */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Outline</p>
              {outlineReady ? (
                <p className="text-sm">{outline.chapters.length} chapters · disclaimer: {outline.disclaimer_required ? "required" : "no"}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Not generated yet.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!!busy} onClick={() => call("generate-outline", { ebook_id: ebook.id, idea_id: ebook.idea_id }, "Generate Outline")}>
                {busy === "Generate Outline" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                {outlineReady ? "Regenerate Outline" : "Generate Outline"}
              </Button>
              {outlineReady && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call("generate-outline", { ebook_id: ebook.id, idea_id: ebook.idea_id }, "Improve Outline")}>
                  Improve Outline
                </Button>
              )}
            </div>
          </div>

          {outlineScores && Object.keys(outlineScores).length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <ScoreBadge label="Structure" value={outlineScores.structure_score} />
              <ScoreBadge label="Practical" value={outlineScores.practical_score} />
              <ScoreBadge label="Buyer" value={outlineScores.buyer_score} />
              <ScoreBadge label="Premium" value={outlineScores.premium_score} />
              <ScoreBadge label="Depth" value={outlineScores.depth_score} />
              <ScoreBadge label="Duplicate" value={outlineScores.duplicate_score} />
            </div>
          )}

          {outlineReady && (
            <div className="border-2 border-foreground/10 p-3 max-h-60 overflow-auto text-sm space-y-1">
              <p><strong>Promise:</strong> {outline.promise_statement}</p>
              {outline.disclaimer_required && outline.disclaimer_text && (
                <p className="text-xs text-muted-foreground">⚠ {outline.disclaimer_text}</p>
              )}
              <ol className="list-decimal pl-5 mt-2 space-y-0.5">
                {outline.chapters.map((c: any) => (
                  <li key={c.index}><strong>{c.title}</strong> — <span className="text-muted-foreground">{c.objective}</span></li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Writing progress */}
      {outlineReady && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Manuscript</p>
                <p className="text-sm">
                  {totalWords.toLocaleString()} / {TARGET_WORDS.toLocaleString()} words · {passedCount}/{chapterTotal} chapters passed
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={!!busy} onClick={() => call("write-chapters", { ebook_id: ebook.id, all: true }, "Start Writing")}>
                  {busy === "Start Writing" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Start Writing
                </Button>
              </div>
            </div>
            <Progress value={wordProgress} />
          </CardContent>
        </Card>
      )}

      {/* Chapter list */}
      {outlineReady && (
        <div className="space-y-2">
          {outline.chapters.map((oc: any) => {
            const row = chapters.find((c) => c.chapter_index === oc.index);
            const s = row?.qc_scores ?? {};
            return (
              <Card key={oc.index}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">Ch {oc.index}</p>
                      <p className="font-medium">{oc.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{oc.objective}</p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <div className="flex gap-1 items-center justify-end">
                        {row?.qc_status === "passed" && <CheckCircle2 className="size-4 text-green-600" />}
                        {row?.qc_status === "failed" && <XCircle className="size-4 text-red-600" />}
                        <Badge variant="outline" className="text-xs">{row?.qc_status ?? "pending"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{(row?.word_count ?? 0).toLocaleString()} w · rw {row?.rewrite_count ?? 0}</p>
                    </div>
                  </div>
                  {row?.qc_scores && Object.keys(s).length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      <ScoreBadge label="Depth" value={s.depth_score} />
                      <ScoreBadge label="Clarity" value={s.clarity_score} />
                      <ScoreBadge label="Practical" value={s.practicality_score} />
                      <ScoreBadge label="Non-Gen" value={s.non_generic_score} />
                      <ScoreBadge label="Buyer" value={s.buyer_value_score} />
                      <ScoreBadge label="Compl." value={s.compliance_safety_score} />
                    </div>
                  )}
                  {row?.rejection_reason && (
                    <p className="text-xs text-red-600">{row.rejection_reason}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" disabled={!!busy}
                      onClick={() => call("write-chapters", { ebook_id: ebook.id, chapter_index: oc.index }, `Rewrite Ch ${oc.index}`)}>
                      {busy === `Rewrite Ch ${oc.index}` ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      {row?.content ? "Rewrite Chapter" : "Write Chapter"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Final Manuscript QC */}
      {allPassed && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Final Manuscript QC</p>
                <p className="text-sm">
                  Status: <strong>{ebook.manuscript_qc_status ?? "not run"}</strong>
                  {" · "}fix attempts: {ebook.manuscript_fix_count ?? 0}
                </p>
              </div>
              <Button size="sm" disabled={!!busy}
                onClick={() => call("final-manuscript-qc", { ebook_id: ebook.id }, "Final QC")}>
                {busy === "Final QC" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Run Final QC
              </Button>
            </div>

            {ebook.final_manuscript_qc && Object.keys(ebook.final_manuscript_qc).length > 0 && (() => {
              const q = ebook.final_manuscript_qc as any;
              const pass = (q.final_manuscript_score ?? 0) >= 85 && (q.compliance_safety_score ?? 0) >= 90 && q.checks?.word_count_ok;
              return (
                <div className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="outline" className={pass ? "bg-green-500/10 text-green-700 border-green-500/30" : "bg-red-500/10 text-red-700 border-red-500/30"}>
                      {pass ? "PASS" : "NEEDS REVIEW"}
                    </Badge>
                    <ScoreBadge label="Final" value={q.final_manuscript_score} />
                    <ScoreBadge label="Depth" value={q.final_content_depth_score} />
                    <ScoreBadge label="Reader Value" value={q.reader_value_score} />
                    <ScoreBadge label="Practical" value={q.practical_tool_score} />
                    <ScoreBadge label="Polish" value={q.editorial_polish_score} />
                    <ScoreBadge label="Compliance" value={q.compliance_safety_score} />
                    <Badge variant="outline" className="font-mono text-xs">Refund Risk {q.refund_risk_score ?? 0}</Badge>
                  </div>

                  {q.checks && (
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {Object.entries(q.checks).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2">
                          {v ? <CheckCircle2 className="size-3.5 text-green-600" /> : <XCircle className="size-3.5 text-red-600" />}
                          <span className={v ? "" : "text-red-700"}>{k.replace(/_/g, " ")}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {Array.isArray(q.blocking_issues) && q.blocking_issues.length > 0 && (
                    <div className="border-l-2 border-red-500 pl-2 text-xs space-y-0.5">
                      <p className="font-medium text-red-700">Blocking issues</p>
                      {q.blocking_issues.map((i: string, idx: number) => <p key={idx}>• {i}</p>)}
                    </div>
                  )}

                  {Array.isArray(q.issues) && q.issues.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">All issues ({q.issues.length})</summary>
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">
                        {q.issues.map((i: string, idx: number) => <li key={idx}>{i}</li>)}
                      </ul>
                    </details>
                  )}

                  {Array.isArray(q.fix_instructions_per_chapter) && q.fix_instructions_per_chapter.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Per-chapter fix notes ({q.fix_instructions_per_chapter.length})</summary>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        {q.fix_instructions_per_chapter.map((f: any, idx: number) => (
                          <li key={idx}><strong>Ch {f.chapter_index}:</strong> {f.instructions}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}



      {/* Final actions */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Manuscript Decision</p>
          <div className="flex gap-2 flex-wrap">
            <Button
              disabled={!allPassed || busy === "Approve Manuscript"}
              onClick={async () => {
                setBusy("Approve Manuscript");
                const { error } = await supabase.from("ebooks").update({
                  writing_status: "manuscript_approved",
                  pipeline_status: "pdf_design",
                  status: "ready_for_qc",
                  qc_status: "approved",
                  rejection_reason: null,
                }).eq("id", ebook.id);
                setBusy(null);
                if (error) toast({ title: "Approve failed", description: error.message, variant: "destructive" });
                else { toast({ title: "Manuscript approved" }); load(); }
              }}
            >
              <CheckCircle2 className="size-4" /> Approve Manuscript
            </Button>
          </div>
          <div className="space-y-2">
            <Textarea placeholder="Optional rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <Button
              variant="destructive"
              disabled={busy === "Reject"}
              onClick={async () => {
                setBusy("Reject");
                const { error } = await supabase.from("ebooks").update({
                  writing_status: "rejected",
                  pipeline_status: "rejected",
                  status: "qc_failed",
                  qc_status: "rejected",
                  rejection_reason: rejectReason || "Rejected by admin",
                }).eq("id", ebook.id);
                setBusy(null);
                if (error) toast({ title: "Reject failed", description: error.message, variant: "destructive" });
                else { toast({ title: "Ebook rejected" }); load(); }
              }}
            >
              <XCircle className="size-4" /> Reject
            </Button>
          </div>
          <Link to="/admin/pipeline" className="text-sm underline text-muted-foreground">← Back to pipeline</Link>
        </CardContent>
      </Card>
    </div>
  );
}
