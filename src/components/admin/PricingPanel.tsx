// PricingPanel — surfaces the Automatic Psychological Pricing report for an ebook.
// Shows recommended/launch/standard prices, A/B tests, tier, confidence, and reasoning.
// Allows Admin to recompute or override the live price on demand.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export interface PricingReportShape {
  recommended_price: string;
  low_price_test: string;
  high_price_test: string;
  pricing_tier: string;
  pricing_reason: string;
  buyer_psychology_reason: string;
  market_positioning: string;
  discount_allowed: boolean;
  launch_price: string;
  standard_price: string;
  bundle_price_recommendation: string;
  price_confidence_score: number;
  scores?: Record<string, number>;
}

interface Props {
  ebookId: string;
  report: PricingReportShape | null;
  livePrice: number | null;
  confidence: number | null;
  onRecompute?: () => void;
}

export function PricingPanel({ ebookId, report, livePrice, confidence, onRecompute }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const needsAttention = (confidence ?? 0) > 0 && (confidence ?? 0) < 85;

  async function recompute(useLaunch: boolean) {
    setBusy(useLaunch ? "launch" : "recompute");
    try {
      const { error } = await supabase.functions.invoke("compute-pricing", {
        body: { ebook_id: ebookId, use_launch_price: useLaunch },
      });
      if (error) throw error;
      toast.success(useLaunch ? "Launch price applied" : "Pricing recomputed");
      onRecompute?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to compute pricing");
    } finally {
      setBusy(null);
    }
  }

  async function applyPrice(price: string, label: string) {
    setBusy(label);
    try {
      const { error } = await supabase.from("ebooks")
        .update({ price: Number(price) }).eq("id", ebookId);
      if (error) throw error;
      toast.success(`Live price set to $${price}`);
      onRecompute?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to set price");
    } finally {
      setBusy(null);
    }
  }

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Pricing</span>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => recompute(false)}>
              {busy === "recompute" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-2">Compute now</span>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No pricing report yet. {livePrice != null && <>Current price: <span className="font-medium text-foreground">${Number(livePrice).toFixed(2)}</span>.</>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span>Recommended Price</span>
            <Badge variant="secondary">{report.pricing_tier}</Badge>
            {needsAttention && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Needs admin attention
              </Badge>
            )}
          </div>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => recompute(false)}>
            {busy === "recompute" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-2">Recompute</span>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <PriceCell label="Low (A/B)"   price={report.low_price_test}    onApply={() => applyPrice(report.low_price_test, "low")}    busy={busy === "low"} />
          <PriceCell label="Launch"      price={report.launch_price}      onApply={() => applyPrice(report.launch_price, "launch")} busy={busy === "launch"} highlight={livePrice === Number(report.launch_price)} />
          <PriceCell label="Recommended" price={report.recommended_price} onApply={() => applyPrice(report.recommended_price, "rec")} busy={busy === "rec"} highlight={livePrice === Number(report.recommended_price)} primary />
          <PriceCell label="High (A/B)"  price={report.high_price_test}   onApply={() => applyPrice(report.high_price_test, "high")} busy={busy === "high"} />
          <PriceCell label="Bundle"      price={report.bundle_price_recommendation} onApply={() => applyPrice(report.bundle_price_recommendation, "bundle")} busy={busy === "bundle"} />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Live price: <span className="font-medium text-foreground">${livePrice != null ? Number(livePrice).toFixed(2) : "—"}</span></span>
          <span>Confidence: <span className={`font-medium ${needsAttention ? "text-destructive" : "text-foreground"}`}>{report.price_confidence_score}/100</span></span>
          <span>Position: <span className="text-foreground">{report.market_positioning}</span></span>
        </div>

        <div className="text-xs space-y-1.5">
          <div><span className="text-muted-foreground">Why this price:</span> {report.pricing_reason}</div>
          <div><span className="text-muted-foreground">Psychology:</span> {report.buyer_psychology_reason}</div>
        </div>

        {report.scores && (
          <div className="grid grid-cols-3 md:grid-cols-4 gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-1 border-t">
            {Object.entries(report.scores).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="truncate">{k.replace(/_/g, " ")}</span>
                <span className="font-medium text-foreground">{v}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriceCell(
  { label, price, onApply, busy, primary, highlight }:
  { label: string; price: string; onApply: () => void; busy?: boolean; primary?: boolean; highlight?: boolean },
) {
  return (
    <button
      onClick={onApply}
      disabled={busy}
      className={`rounded-md border p-2 text-left transition hover:bg-accent ${
        primary ? "border-primary/60 bg-primary/5" : ""
      } ${highlight ? "ring-2 ring-primary" : ""}`}
      title={`Apply $${price} as live price`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">${price}</div>
    </button>
  );
}
