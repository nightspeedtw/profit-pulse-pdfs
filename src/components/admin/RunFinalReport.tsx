// Final report shown when an Autopilot run completes.
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

export interface RunSummary {
  ebook_id?: string;
  title?: string;
  pdf_url?: string;
  cover_url?: string;
  shopify_product_id?: string;
  shopify_status?: string;
  final_quality_score?: number;
  conversion_score?: number;
  compliance_safety_score?: number;
  duration_ms?: number;
  auto_publish?: boolean;
}

function fmtMs(ms?: number) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RunFinalReport({
  summary, totalCost, autoFixAttempts, failedGates,
}: {
  summary: RunSummary;
  totalCost: number;
  autoFixAttempts: number;
  failedGates: string[];
}) {
  return (
    <Card className="border-2 border-emerald-700 bg-emerald-50/40">
      <CardContent className="p-5 space-y-4">
        <h2 className="font-display text-lg uppercase tracking-wide">Run Complete</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Title" value={summary.title ?? "—"} />
          <Stat label="Final quality" value={summary.final_quality_score != null ? `${summary.final_quality_score}` : "—"} />
          <Stat label="Conversion" value={summary.conversion_score != null ? `${summary.conversion_score}` : "—"} />
          <Stat label="Compliance" value={summary.compliance_safety_score != null ? `${summary.compliance_safety_score}` : "—"} />
          <Stat label="Shopify" value={summary.shopify_status ?? (summary.shopify_product_id ? "draft" : "—")} />
          <Stat label="Total cost" value={`$${totalCost.toFixed(3)}`} />
          <Stat label="Duration" value={fmtMs(summary.duration_ms)} />
          <Stat label="Auto-fix attempts" value={String(autoFixAttempts)} />
        </div>
        {failedGates.length > 0 && (
          <p className="text-xs text-orange-700">
            Failed gates resolved by auto-fix: {failedGates.join(", ")}
          </p>
        )}
        <div className="flex gap-3 flex-wrap text-sm">
          {summary.pdf_url && (
            <a className="underline inline-flex items-center gap-1" href={summary.pdf_url} target="_blank" rel="noreferrer">
              PDF <ExternalLink className="size-3" />
            </a>
          )}
          {summary.cover_url && (
            <a className="underline inline-flex items-center gap-1" href={summary.cover_url} target="_blank" rel="noreferrer">
              Cover <ExternalLink className="size-3" />
            </a>
          )}
          {summary.ebook_id && (
            <a className="underline inline-flex items-center gap-1" href={`/admin/ebook/${summary.ebook_id}`}>
              Open ebook →
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-foreground/15 p-2 bg-background">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">{label}</div>
      <div className="text-sm font-medium truncate" title={value}>{value}</div>
    </div>
  );
}
