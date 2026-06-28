import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, ChevronUp, Check, X, Loader2, ShieldCheck, Send, Lock } from "lucide-react";
import { toast } from "sonner";

interface PdfQc {
  // legacy snake_case
  cover_premium_score?: number;
  thumbnail_readability_score?: number;
  interior_layout_score?: number;
  worksheet_quality_score?: number;
  diagram_quality_score?: number;
  product_value_score?: number;
  final_pdf_premium_score?: number;
  // current camelCase from build-pdf
  coverPremiumScore?: number;
  thumbnailReadabilityScore?: number;
  interiorLayoutScore?: number;
  worksheetQualityScore?: number;
  diagramQualityScore?: number;
  productValueScore?: number;
  finalPdfPremiumScore?: number;
  pdf_status?: string;
  blocked_for_publish?: boolean;
  report?: Record<string, unknown>;
  notes?: string[];
}

interface EbookLike {
  id: string;
  cover_url: string | null;
  cover_score: number | null;
  cover_approved: boolean;
  pdf_url: string | null;
  product_description: string | null;
  shopify_product_id: string | null;
  shopify_status?: string | null;
  conversion_score?: number | null;
  final_quality_score?: number | null;
  compliance_safety_score?: number | null;
  pdf_qc?: PdfQc | null;
  auto_approved?: boolean | null;
  auto_publish?: boolean | null;
  final_approved?: boolean | null;
  status: string;
}

interface Props {
  ebook: EbookLike;
  onChanged: () => void | Promise<void>;
}

interface Gate {
  label: string;
  pass: boolean;
  detail: string;
  blocking: boolean;
}

const THRESHOLDS = {
  cover: 90,
  thumbnail: 90,
  interior: 85,
  worksheet: 85,
  diagram: 85,
  product: 80,
  final: 90,
};

function scoreColor(v: number | undefined, min: number) {
  if (v == null) return "bg-muted text-muted-foreground";
  if (v >= min) return "bg-green-600 text-white";
  if (v >= min - 10) return "bg-amber-500 text-white";
  return "bg-destructive text-destructive-foreground";
}

function ScoreTile({ label, value, min }: { label: string; value: number | undefined; min: number }) {
  return (
    <div className="border-2 border-foreground/15 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className={`px-2 py-0.5 text-sm font-bold ${scoreColor(value, min)}`}>
          {value ?? "—"}
        </span>
        <span className="text-[10px] text-muted-foreground">min {min}</span>
      </div>
      <Progress value={Math.min(100, value ?? 0)} className="h-1 mt-2" />
    </div>
  );
}

export function FinalApproval({ ebook, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const qc = ebook.pdf_qc ?? {};
  // Read scores from both camelCase (current build-pdf) and snake_case (legacy / report block).
  const r = (qc.report ?? {}) as Record<string, number | undefined>;
  const pick = (...vals: (number | undefined)[]) => vals.find((v) => typeof v === "number");
  const coverScore = pick(qc.coverPremiumScore, qc.cover_premium_score, r.cover_score, ebook.cover_score ?? undefined);
  const thumbScore = pick(qc.thumbnailReadabilityScore, qc.thumbnail_readability_score, r.thumbnail_score);
  const interiorScore = pick(qc.interiorLayoutScore, qc.interior_layout_score, r.interior_score);
  const worksheetScore = pick(qc.worksheetQualityScore, qc.worksheet_quality_score, r.worksheet_score);
  const diagramScore = pick(qc.diagramQualityScore, qc.diagram_quality_score, r.diagram_score);
  const finalScore = pick(qc.finalPdfPremiumScore, qc.final_pdf_premium_score, r.final_pdf_premium_score, ebook.final_quality_score ?? undefined);
  const productScore = pick(qc.productValueScore, qc.product_value_score, ebook.conversion_score ?? undefined);
  const pdfReady = qc.pdf_status === "pdf_ready";

  // Collapsed gate set — the PDF auto-QC pipeline already enforces cover/thumbnail/
  // interior/worksheet/diagram/final-premium internally. Only show the gates an
  // admin still actively controls: PDF Ready, cover approval, product copy, Shopify.
  const gates = useMemo<Gate[]>(() => ([
    { label: "PDF passed premium auto-QC", pass: pdfReady && !qc.blocked_for_publish, detail: pdfReady ? `pdf_status=pdf_ready · score ${finalScore ?? "—"}` : `pdf_status=${qc.pdf_status ?? "—"} (must be pdf_ready)`, blocking: true },
    { label: "Cover approved by admin", pass: !!ebook.cover_approved && !!ebook.cover_url, detail: ebook.cover_approved ? "cover text legible, premium, on-topic" : "review and approve cover", blocking: true },
    { label: `Product page conversion ≥ ${THRESHOLDS.product}`, pass: (productScore ?? 0) >= THRESHOLDS.product, detail: `score ${productScore ?? "—"}`, blocking: true },
    { label: "Shopify product description present", pass: !!ebook.product_description, detail: ebook.product_description ? "OK" : "missing metadata", blocking: true },
    { label: "Shopify draft created", pass: !!ebook.shopify_product_id, detail: ebook.shopify_product_id ? `id ${ebook.shopify_product_id}` : "push to Shopify draft first", blocking: true },
  ]), [ebook, qc, productScore, finalScore, pdfReady]);

  const allPass = gates.every((g) => g.pass);
  const failingBlocking = gates.filter((g) => !g.pass && g.blocking);
  const blocked = qc.blocked_for_publish === true || failingBlocking.length > 0;
  const canPublish = allPass && !!ebook.final_approved && !blocked;

  const update = async (patch: Partial<EbookLike>) => {
    setBusy("save");
    const { error } = await supabase.from("ebooks").update(patch as never).eq("id", ebook.id);
    setBusy(null);
    if (error) toast.error(error.message);
    else await onChanged();
  };

  const approve = async () => {
    setBusy("approve");
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("ebooks").update({
      final_approved: true,
      final_approved_at: new Date().toISOString(),
      final_approved_by: u.user?.id ?? null,
    } as never).eq("id", ebook.id);
    setBusy(null);
    if (error) toast.error(error.message);
    else { toast.success("Final approval recorded"); await onChanged(); }
  };

  const unapprove = async () => {
    await update({ final_approved: false } as Partial<EbookLike>);
  };

  const publish = async () => {
    setBusy("publish");
    try {
      const { data, error } = await supabase.functions.invoke("shopify-publish", { body: { ebook_id: ebook.id } });
      if (error) throw error;
      const errMsg = (data as { error?: string } | null)?.error;
      if (errMsg) throw new Error(errMsg);
      toast.success("Published to Shopify");
      await onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-2 border-foreground">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-5" /> Final approval
          </span>
          <div className="flex items-center gap-2">
            {blocked && <Badge variant="destructive">Blocked</Badge>}
            {allPass && !blocked && <Badge className="bg-green-600">All QC pass</Badge>}
            {ebook.final_approved && <Badge>Approved</Badge>}
            {ebook.shopify_status === "published" && <Badge className="bg-green-600">Live on Shopify</Badge>}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <ScoreTile label="Cover" value={coverScore} min={THRESHOLDS.cover} />
          <ScoreTile label="Thumbnail" value={qc.thumbnail_readability_score} min={THRESHOLDS.thumbnail} />
          <ScoreTile label="Interior" value={qc.interior_layout_score} min={THRESHOLDS.interior} />
          <ScoreTile label="Worksheet" value={qc.worksheet_quality_score} min={THRESHOLDS.worksheet} />
          <ScoreTile label="Diagram" value={qc.diagram_quality_score} min={THRESHOLDS.diagram} />
          <ScoreTile label="Product Page" value={productScore} min={THRESHOLDS.product} />
          <ScoreTile label="Final Premium" value={qc.final_pdf_premium_score} min={THRESHOLDS.final} />
          <div className="border-2 border-foreground/15 p-3 flex flex-col justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Gates passed</div>
            <div className="text-2xl font-bold">{gates.filter((g) => g.pass).length}/{gates.length}</div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-center justify-between gap-3 border-2 border-foreground/20 p-3">
            <div>
              <Label className="text-sm">Auto Approved</Label>
              <p className="text-xs text-muted-foreground">Auto-mark final_approved when all gates pass.</p>
            </div>
            <Switch
              checked={!!ebook.auto_approved}
              onCheckedChange={(v) => update({ auto_approved: v } as Partial<EbookLike>)}
              disabled={!!busy}
            />
          </label>
          <label className="flex items-center justify-between gap-3 border-2 border-foreground/20 p-3">
            <div>
              <Label className="text-sm">Auto Publish</Label>
              <p className="text-xs text-muted-foreground">Auto-push to Shopify after approval.</p>
            </div>
            <Switch
              checked={!!ebook.auto_publish}
              onCheckedChange={(v) => update({ auto_publish: v } as Partial<EbookLike>)}
              disabled={!!busy}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between border-2 border-foreground/20 p-3 text-sm font-medium hover:bg-muted/40"
        >
          <span className="flex items-center gap-2">
            QC checklist ({gates.filter((g) => g.pass).length}/{gates.length} pass)
            {failingBlocking.length > 0 && (
              <Badge variant="destructive">{failingBlocking.length} blocking</Badge>
            )}
          </span>
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {open && (
          <ul className="space-y-1 border-2 border-foreground/15 p-3">
            {gates.map((g) => (
              <li key={g.label} className="flex items-start gap-2 text-sm py-1">
                {g.pass ? (
                  <Check className="size-4 text-green-600 mt-0.5 shrink-0" />
                ) : (
                  <X className="size-4 text-destructive mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className={g.pass ? "" : "text-destructive font-medium"}>{g.label}</div>
                  <div className="text-xs text-muted-foreground">{g.detail}</div>
                </div>
              </li>
            ))}
            {(qc.notes ?? []).length > 0 && (
              <li className="text-xs text-muted-foreground border-t border-foreground/10 mt-2 pt-2">
                Notes: {(qc.notes ?? []).join(" · ")}
              </li>
            )}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!ebook.final_approved ? (
            <Button onClick={approve} disabled={!!busy || !allPass || blocked}>
              {busy === "approve" && <Loader2 className="size-4 animate-spin mr-1" />}
              <ShieldCheck className="size-4 mr-1" /> Final approve
            </Button>
          ) : (
            <Button variant="outline" onClick={unapprove} disabled={!!busy}>
              Unapprove
            </Button>
          )}
          <Button
            onClick={publish}
            disabled={!!busy || !canPublish || ebook.shopify_status === "published"}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {busy === "publish" ? <Loader2 className="size-4 animate-spin mr-1" /> : canPublish ? <Send className="size-4 mr-1" /> : <Lock className="size-4 mr-1" />}
            {ebook.shopify_status === "published" ? "Already published" : "Publish to Shopify"}
          </Button>
          {!allPass && (
            <p className="text-xs text-destructive self-center">
              Publish disabled — fix {failingBlocking.length} blocking gate{failingBlocking.length === 1 ? "" : "s"} above.
            </p>
          )}
          {allPass && !ebook.final_approved && (
            <p className="text-xs text-muted-foreground self-center">All gates pass — admin must final-approve before publish.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
