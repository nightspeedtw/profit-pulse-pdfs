// Milestone 6 — Premium PDF Layout dashboard.
// Render · Preview · Inspect QC · Approve PDF. Publishing is server-blocked
// until pdf_approved AND pdf_score >= 85 (see publishGate in _shared/qc.ts).
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, FileText, CheckCircle2, XCircle, ExternalLink, Sparkles, Download } from "lucide-react";
import { WorksheetOverflowReview } from "@/components/admin/WorksheetOverflowReview";
import { downloadAdminPdf } from "@/lib/pdf";

type Ebook = any;

function ScoreBadge({ label, value }: { label: string; value: number | undefined | null }) {
  const v = Number(value ?? 0);
  const cls = v >= 85 ? "bg-green-500/10 text-green-700 border-green-500/30"
    : v >= 70 ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30"
    : "bg-red-500/10 text-red-700 border-red-500/30";
  return <Badge variant="outline" className={`${cls} font-mono text-xs`}>{label} {v}</Badge>;
}

const CHECK_LABELS: { key: string; label: string }[] = [
  { key: "has_cover", label: "premium cover" },
  { key: "has_title_page", label: "title page" },
  { key: "has_copyright_disclaimer", label: "copyright/disclaimer" },
  { key: "has_toc", label: "table of contents" },
  { key: "has_chapter_dividers", label: "chapter divider pages" },
  { key: "has_callouts", label: "callout boxes" },
  { key: "has_worksheets", label: "worksheets" },
  { key: "has_checklists", label: "checklists" },
  { key: "has_framework_diagrams", label: "framework diagrams" },
  { key: "has_action_plan", label: "action plan" },
  { key: "has_bonus_section", label: "bonus section" },
  { key: "has_page_numbers", label: "page numbers" },
  { key: "has_headers_footers", label: "headers/footers" },
  { key: "premium_typography", label: "premium typography" },
  { key: "clean_margins", label: "clean margins" },
  { key: "strong_hierarchy", label: "strong hierarchy" },
  { key: "good_spacing", label: "good spacing" },
  { key: "no_raw_markdown_tables", label: "no raw markdown tables" },
  { key: "no_cut_off_text", label: "no cut-off text" },
  { key: "no_duplicated_headings", label: "no duplicated headings" },
  { key: "no_broken_diagrams", label: "no broken diagrams" },
];

export default function EbookPDF() {
  const { id } = useParams();
  const [ebook, setEbook] = useState<Ebook | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    const { data } = await supabase.from("ebooks").select("*").eq("id", id).maybeSingle();
    setEbook(data);
  }
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (ebook?.pdf_status !== "rendering") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [ebook?.pdf_status]);

  async function render() {
    setBusy("Render");
    try {
      const { data, error } = await supabase.functions.invoke("render-pdf", { body: { ebook_id: id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: data?.passed ? "PDF rendered — PASS" : "PDF rendered — needs review",
        description: `Score ${data?.qc?.final_pdf_premium_score ?? "?"} · ${data?.page_count ?? 0} pages`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Render failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function approve(next: boolean) {
    setBusy(next ? "Approve" : "Unapprove");
    const { error } = await supabase.from("ebooks").update({ pdf_approved: next }).eq("id", id);
    setBusy(null);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: next ? "PDF approved" : "Approval removed" }); load(); }
  }

  if (!ebook) return <div className="p-6"><Loader2 className="animate-spin" /></div>;

  const qc = (ebook.pdf_qc ?? {}) as any;
  const checks = (qc.checks ?? {}) as Record<string, boolean>;
  const score = Number(ebook.pdf_score ?? 0);
  const layout = Number(ebook.pdf_layout_score ?? 0);
  const read = Number(ebook.pdf_readability_score ?? 0);
  const worksheet = Number(ebook.pdf_worksheet_score ?? 0);
  const diagram = Number(ebook.pdf_diagram_score ?? 0);
  const passed = ebook.pdf_status === "rendered" || ebook.pdf_status === "approved";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ PDF Layout Engine ]</p>
          <h1 className="font-display text-3xl uppercase leading-tight">{ebook.title}</h1>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Badge variant="outline">6×9in · premium print</Badge>
            <Badge variant="outline">pdf_status: {ebook.pdf_status ?? "idle"}</Badge>
            {ebook.pdf_page_count ? <Badge variant="outline">{ebook.pdf_page_count} pages</Badge> : null}
            {ebook.pdf_approved && <Badge className="bg-green-500/10 text-green-700 border-green-500/30">approved</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" /></Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6">
        {/* Controls + QC */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Render</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" disabled={!!busy || ebook.pdf_status === "rendering"} onClick={render}>
                  {busy === "Render" || ebook.pdf_status === "rendering"
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Sparkles className="size-4" />}
                  {ebook.pdf_url ? "Re-render PDF" : "Render Premium PDF"}
                </Button>
                {ebook.pdf_url && (
                  <Button asChild size="sm" variant="outline">
                    <a href={ebook.pdf_url} target="_blank" rel="noreferrer">
                      <FileText className="size-4" /> Open PDF <ExternalLink className="size-3" />
                    </a>
                  </Button>
                )}
                {ebook.pdf_html_url && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={ebook.pdf_html_url} target="_blank" rel="noreferrer">
                      View HTML source <ExternalLink className="size-3" />
                    </a>
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Renders the manuscript with premium HTML/CSS layout and Chromium headless (Browserless). Includes cover, title, copyright, TOC, dividers, callouts, worksheets, checklists, framework diagrams, action plan, bonus, headers/footers with page numbers.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">PDF QC</p>
                <Badge variant="outline" className={passed
                  ? "bg-green-500/10 text-green-700 border-green-500/30"
                  : ebook.pdf_status === "needs_review"
                    ? "bg-red-500/10 text-red-700 border-red-500/30"
                    : "bg-muted text-muted-foreground"}>
                  {ebook.pdf_status === "rendered" || ebook.pdf_status === "approved"
                    ? "PASS"
                    : ebook.pdf_status === "needs_review" ? "NEEDS REVIEW"
                    : ebook.pdf_status === "rendering" ? "RENDERING…"
                    : "NOT RUN"}
                </Badge>
              </div>
              {ebook.pdf_url && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    <ScoreBadge label="Final PDF Premium" value={score} />
                    <ScoreBadge label="Layout" value={layout} />
                    <ScoreBadge label="Readability" value={read} />
                    <ScoreBadge label="Worksheet" value={worksheet} />
                    <ScoreBadge label="Diagram" value={diagram} />
                    <ScoreBadge label="Cover" value={ebook.cover_score} />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {CHECK_LABELS.map((c) => {
                      const v = checks[c.key];
                      return (
                        <div key={c.key} className="flex items-center gap-2">
                          {v ? <CheckCircle2 className="size-3.5 text-green-600" />
                             : <XCircle className="size-3.5 text-red-600" />}
                          <span className={v ? "" : "text-red-700"}>{c.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  {Array.isArray(qc.issues) && qc.issues.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Issues ({qc.issues.length})</summary>
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">
                        {qc.issues.map((i: string, idx: number) => <li key={idx}>{i}</li>)}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Approval</p>
              <p className="text-xs text-muted-foreground">
                Listing the ebook is blocked until the PDF is approved <em>and</em> Final PDF Premium Score ≥ 85.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button disabled={busy === "Approve" || !passed || score < 85} onClick={() => approve(true)}>
                  <CheckCircle2 className="size-4" /> Approve PDF
                </Button>
                {ebook.pdf_approved && (
                  <Button variant="outline" disabled={busy === "Unapprove"} onClick={() => approve(false)}>
                    Unapprove
                  </Button>
                )}
              </div>
              <div className="text-sm pt-2 space-x-4">
                <Link to={`/admin/ebook/${ebook.id}/writing`} className="underline text-muted-foreground">← Writing</Link>
                <Link to={`/admin/ebook/${ebook.id}/cover`} className="underline text-muted-foreground">← Cover</Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Download panel (preview disabled — iframe was unreliable) */}
        <div className="space-y-3">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="w-full aspect-[6/9] grid place-items-center bg-muted border-2 border-foreground/10 text-muted-foreground text-sm p-6 text-center">
                {ebook.pdf_url ? (
                  <div className="space-y-2">
                    <FileText className="size-10 mx-auto text-foreground/60" />
                    <p className="font-medium text-foreground">PDF ready</p>
                    <p className="text-xs">In-browser preview is disabled. Download or open in a new tab.</p>
                  </div>
                ) : (
                  <span>No PDF yet — click Render</span>
                )}
              </div>
              {ebook.pdf_url && (
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    disabled={busy === "Download"}
                    onClick={async () => {
                      setBusy("Download");
                      try {
                        await downloadAdminPdf(ebook.id, ebook.title);
                      } catch (e: any) {
                        toast({ title: "Download failed", description: e.message ?? String(e), variant: "destructive" });
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === "Download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    Download PDF
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={ebook.pdf_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" /> Open in new tab
                    </a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          {ebook.pdf_generated_at && (
            <p className="text-xs text-muted-foreground">
              Generated {new Date(ebook.pdf_generated_at).toLocaleString()} · v{ebook.pdf_render_count}
            </p>
          )}
        </div>

      </div>

      <WorksheetOverflowReview
        ebookId={ebook.id}
        overflowScore={ebook.worksheet_table_overflow_score ?? qc.worksheet_table_overflow_score ?? null}
        initialPreviews={ebook.worksheet_previews_json ?? null}
      />
    </div>
  );
}
