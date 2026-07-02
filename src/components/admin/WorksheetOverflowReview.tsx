// WorksheetOverflowReview
//
// Displays side-by-side before/after PNG previews for every worksheet table
// that failed the overflow / cropping check on a specific ebook.
//
// Data source: `ebooks.worksheet_previews_json` (populated by the
// `worksheet-preview` edge function). If no previews exist yet — or the caller
// wants to refresh — the "Generate previews" button invokes the function.
//
// After the operator has verified the fixes visually, the "Approve fixes &
// Re-render PDF" button calls `render-pdf`, which regenerates the PDF and
// re-runs the automated overflow score.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ImageIcon, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type PreviewEntry = {
  chapter_index: number;
  chapter_title: string;
  worksheet_title: string;
  kind: string;
  failed: boolean;
  reason: string;
  headers_raw: string[];
  headers_shortened: string[];
  before_url: string | null;
  after_url: string | null;
};

type PreviewPayload = {
  generated_at?: string;
  count?: number;
  entries?: PreviewEntry[];
};

type Props = {
  ebookId: string;
  overflowScore?: number | null;
  initialPreviews?: PreviewPayload | null;
  compact?: boolean;
};

export function WorksheetOverflowReview({ ebookId, overflowScore, initialPreviews, compact }: Props) {
  const [payload, setPayload] = useState<PreviewPayload | null>(initialPreviews ?? null);
  const [generating, setGenerating] = useState(false);
  const [rerendering, setRerendering] = useState(false);

  // Refetch from DB in case the parent hasn't hydrated yet.
  useEffect(() => {
    if (initialPreviews) { setPayload(initialPreviews); return; }
    let cancel = false;
    (async () => {
      const { data } = await supabase.from("ebooks")
        .select("worksheet_previews_json").eq("id", ebookId).maybeSingle();
      if (!cancel && data?.worksheet_previews_json) {
        setPayload(data.worksheet_previews_json as PreviewPayload);
      }
    })();
    return () => { cancel = true; };
  }, [ebookId, initialPreviews]);

  async function generate() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("worksheet-preview", {
        body: { ebook_id: ebookId },
      });
      if (error) throw error;
      const p = data as PreviewPayload;
      setPayload(p);
      if ((p.entries ?? []).length === 0) {
        toast.success("No worksheets currently fail the overflow check.");
      } else {
        toast.success(`Rendered ${p.entries!.length} worksheet preview${p.entries!.length === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to render previews");
    } finally { setGenerating(false); }
  }

  async function rerender() {
    setRerendering(true);
    try {
      const { error } = await supabase.functions.invoke("render-pdf", {
        body: { ebook_id: ebookId, force: true },
      });
      if (error) throw error;
      toast.success("PDF re-render started. New overflow score will appear once it completes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-render failed");
    } finally { setRerendering(false); }
  }

  const entries = payload?.entries ?? [];
  const failing = entries.filter((e) => e.failed);
  const scoreOk = overflowScore == null || overflowScore >= 100;

  return (
    <Card className="border-2 border-foreground">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-sm font-mono uppercase tracking-wide flex items-center gap-2">
            <ImageIcon className="size-4" /> Worksheet overflow review
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Verify the wrapping/shortening fixes visually before uploading to Shopify.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overflowScore != null && (
            <Badge variant={scoreOk ? "default" : "destructive"} className="font-mono">
              Overflow score {overflowScore}/100
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="size-3 animate-spin mr-2" /> : <RefreshCw className="size-3 mr-2" />}
            {payload ? "Regenerate previews" : "Generate previews"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!payload && (
          <p className="text-xs text-muted-foreground">
            No previews generated yet. Click <strong>Generate previews</strong> to render the failing worksheets.
          </p>
        )}

        {payload && failing.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            All worksheets fit within the 6in page. Nothing to review.
          </div>
        )}

        {failing.length > 0 && (
          <div className={compact ? "grid gap-4" : "grid gap-4 lg:grid-cols-1"}>
            {failing.map((e) => (
              <PreviewCard key={e.chapter_index} entry={e} />
            ))}
          </div>
        )}

        {failing.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-foreground/10">
            <p className="text-xs text-muted-foreground max-w-xl">
              Approving triggers a fresh PDF render with the wrapped headers. The automated
              overflow score must reach 100/100 before the pipeline hands off to Shopify.
            </p>
            <Button size="sm" onClick={rerender} disabled={rerendering}>
              {rerendering ? <Loader2 className="size-3 animate-spin mr-2" /> : <CheckCircle2 className="size-3 mr-2" />}
              Approve fixes &amp; re-render PDF
            </Button>
          </div>
        )}

        {payload?.generated_at && (
          <p className="text-[10px] font-mono text-muted-foreground">
            Previews generated {new Date(payload.generated_at).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewCard({ entry }: { entry: PreviewEntry }) {
  return (
    <div className="border border-foreground/20 rounded-md p-3 space-y-3 bg-background">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Chapter {entry.chapter_index} · {entry.kind.replace(/_/g, " ")}
          </p>
          <h4 className="font-semibold text-sm">{entry.worksheet_title}</h4>
          <p className="text-xs text-muted-foreground">{entry.chapter_title}</p>
        </div>
        <Badge variant="destructive" className="text-[10px] font-mono">
          <AlertTriangle className="size-3 mr-1" /> Failed overflow
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground italic">{entry.reason}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PreviewPane label="Before (cropped)" tone="bad" url={entry.before_url} />
        <PreviewPane label="After (wrapped fix)" tone="good" url={entry.after_url} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
        <HeaderList label="Raw headers" values={entry.headers_raw} />
        <HeaderList label="Shortened / wrapped" values={entry.headers_shortened} />
      </div>
    </div>
  );
}

function PreviewPane({ label, tone, url }: { label: string; tone: "good" | "bad"; url: string | null }) {
  const borderClr = tone === "good" ? "border-emerald-500/60" : "border-red-500/60";
  const badgeClr = tone === "good" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800";
  return (
    <div className={`border-2 rounded ${borderClr} overflow-hidden bg-muted/20`}>
      <div className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${badgeClr}`}>{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} className="w-full h-auto block" />
        </a>
      ) : (
        <div className="p-6 text-center text-xs text-muted-foreground">Preview not available</div>
      )}
    </div>
  );
}

function HeaderList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="text-muted-foreground uppercase tracking-wider text-[9px] mb-1">{label}</p>
      <ul className="space-y-0.5">
        {values.map((v, i) => (
          <li key={i} className="truncate" title={v}>· {v}</li>
        ))}
      </ul>
    </div>
  );
}
