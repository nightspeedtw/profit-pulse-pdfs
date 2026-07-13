import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, ShieldCheck, ShieldAlert, ExternalLink } from "lucide-react";

interface Finding {
  id: string;
  rule_id: string;
  category: string;
  page_number: number | null;
  measured_value: Record<string, unknown>;
  threshold: Record<string, unknown>;
  passed: boolean;
  severity: "critical" | "major" | "minor";
  evidence_url: string | null;
  repair_action: string | null;
  repair_attempts: number;
  qc_rule_version: string | null;
}

interface Book {
  id: string;
  title: string | null;
  cover_url: string | null;
  pdf_url: string | null;
  sellable: boolean;
  overall_qc_score: number | null;
  qc_rule_version: string | null;
  qc_scorecard: {
    version?: string;
    overall_score?: number;
    category_scores?: Record<string, number>;
    critical_errors?: string[];
    failed_categories?: string[];
    reasons?: string[];
    computed_at?: string;
  } | null;
  human_review_reason: string | null;
}

export default function KidsQcReport() {
  const { id } = useParams<{ id: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    const [b, f] = await Promise.all([
      supabase.from("ebooks_kids").select("id,title,cover_url,pdf_url,sellable,overall_qc_score,qc_rule_version,qc_scorecard,human_review_reason").eq("id", id).single(),
      supabase.from("qc_findings").select("*").eq("ebook_id", id).order("passed").order("severity"),
    ]);
    setBook((b.data as unknown) as Book | null);
    setFindings(((f.data ?? []) as unknown) as Finding[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const rerunQc = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("kids-qc-run", { body: { ebook_id: id } });
      if (error) throw error;
      toast({ title: "QC complete", description: `Overall ${(data as { verdict?: { overall_score?: number } })?.verdict?.overall_score ?? "?"}` });
      await load();
    } catch (e) {
      toast({ title: "QC failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  if (!book) return <div className="p-6">Loading…</div>;

  const cats = book.qc_scorecard?.category_scores ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl uppercase">QC Report</h1>
          <p className="text-sm text-muted-foreground">{book.title ?? "—"}</p>
          <p className="text-[10px] text-muted-foreground font-mono">rule version: {book.qc_rule_version ?? book.qc_scorecard?.version ?? "—"}</p>
        </div>
        <div className="flex gap-2 items-center">
          {book.sellable ? (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 font-mono text-xs uppercase">
              <ShieldCheck className="size-4" /> Sellable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-red-500/15 text-red-700 font-mono text-xs uppercase">
              <ShieldAlert className="size-4" /> Not sellable
            </span>
          )}
          <Button onClick={rerunQc} disabled={busy} variant="outline">
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Re-run QC
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="p-4 border-2 border-foreground col-span-1">
          <div className="text-[10px] uppercase font-mono text-muted-foreground">Overall score</div>
          <div className="text-4xl font-display tabular-nums">{book.overall_qc_score ?? "—"}</div>
          <div className="text-xs text-muted-foreground mt-2">threshold ≥ 90</div>
        </Card>
        <Card className="p-4 border-2 border-foreground col-span-3">
          <div className="text-[10px] uppercase font-mono text-muted-foreground mb-2">Category scores</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {Object.entries(cats).map(([c, v]) => (
              <div key={c} className="flex items-center justify-between border-b border-foreground/10 py-1">
                <span className="capitalize">{c.replace(/_/g, " ")}</span>
                <span className={`tabular-nums font-mono ${v < 85 ? "text-red-600" : "text-emerald-700"}`}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {book.qc_scorecard?.reasons?.length ? (
        <Card className="p-4 border-2 border-red-600 bg-red-50/40">
          <div className="text-xs uppercase font-mono text-red-700 mb-2">Blocking reasons</div>
          <ul className="text-sm space-y-1">
            {book.qc_scorecard.reasons.map((r, i) => (<li key={i}>• {r}</li>))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-4 border-2 border-foreground">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl uppercase">Findings ({findings.length})</h2>
          <div className="flex gap-2 text-xs">
            {book.pdf_url && <a href={book.pdf_url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">PDF <ExternalLink className="size-3" /></a>}
            {book.cover_url && <a href={book.cover_url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">Cover <ExternalLink className="size-3" /></a>}
          </div>
        </div>
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No findings yet — run QC.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-foreground text-left">
                  <th className="p-2">Rule</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Severity</th>
                  <th className="p-2">Passed</th>
                  <th className="p-2">Page</th>
                  <th className="p-2">Measured</th>
                  <th className="p-2">Threshold</th>
                  <th className="p-2">Repair</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={f.id} className={`border-b border-foreground/10 ${f.passed ? "" : "bg-red-50/40"}`}>
                    <td className="p-2 font-mono">{f.rule_id}</td>
                    <td className="p-2">{f.category}</td>
                    <td className="p-2 uppercase">{f.severity}</td>
                    <td className="p-2">{f.passed ? "✓" : "✗"}</td>
                    <td className="p-2 tabular-nums">{f.page_number ?? "—"}</td>
                    <td className="p-2 font-mono max-w-[240px] truncate" title={JSON.stringify(f.measured_value)}>{JSON.stringify(f.measured_value)}</td>
                    <td className="p-2 font-mono max-w-[200px] truncate" title={JSON.stringify(f.threshold)}>{JSON.stringify(f.threshold)}</td>
                    <td className="p-2">{f.repair_action ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
