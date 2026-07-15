import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { computePreview, usd, num, pct, type MarketRow } from "@/lib/royalty/math";
import { createQuote, reserveQuote } from "@/lib/royalty/api";
import { toast } from "@/components/ui/sonner";
import { Loader2, Info } from "lucide-react";

interface Props {
  bookId: string;
  market: MarketRow;
}

/**
 * Two-way sync calculator (USD subtotal ⇄ units), live client preview,
 * server-confirmed on Reserve. Never trust the preview for the actual
 * ownership row — Reserve rebuilds the quote server-side.
 */
export function PurchaseCalculator({ bookId, market }: Props) {
  const [amount, setAmount] = useState<string>("20");
  const [units, setUnits] = useState<string>("");
  const [driver, setDriver] = useState<"usd" | "units">("usd");
  const [submitting, setSubmitting] = useState(false);

  const preview = useMemo(() => {
    if (driver === "usd") {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return null;
      const r = computePreview(market, { usd: n });
      if (r) setUnits(String(r.units)); // keep the other field in sync
      return r;
    }
    const n = Number(units);
    if (!Number.isFinite(n) || n <= 0) return null;
    const r = computePreview(market, { units: Math.floor(n) });
    if (r) setAmount(r.subtotal.toFixed(2));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver === "usd" ? amount : units, market]);

  const disabled = !preview || preview.below_minimum || preview.supply_exceeded;

  async function onReserve() {
    if (!preview) return;
    setSubmitting(true);
    try {
      const q = await createQuote(bookId, driver === "usd" ? { amount_usd: preview.subtotal } : { units: preview.units });
      if (!q.ok || !q.quote) {
        toast.error(q.message ?? q.error ?? "Could not create quote");
        return;
      }
      const r = await reserveQuote(String(q.quote.id));
      if (!r.ok) {
        toast.error(r.error ?? "Could not reserve");
        return;
      }
      toast.success(r.message ?? "Payment activation is coming soon. Your calculation has been saved.");
    } catch (e) {
      toast.error((e as Error).message ?? "Reserve failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="amt">USD subtotal</Label>
          <Input
            id="amt"
            type="number"
            min={market.minimum_purchase_usd}
            step="0.01"
            value={amount}
            onFocus={() => setDriver("usd")}
            onChange={(e) => { setDriver("usd"); setAmount(e.target.value); }}
          />
        </div>
        <div>
          <Label htmlFor="units">Royalty Units</Label>
          <Input
            id="units"
            type="number"
            min={1}
            step="1"
            value={units}
            onFocus={() => setDriver("units")}
            onChange={(e) => { setDriver("units"); setUnits(e.target.value); }}
          />
        </div>
      </div>

      {preview?.below_minimum && (
        <Alert variant="destructive">
          <AlertDescription>
            Minimum Royalty Unit purchase is {usd(market.minimum_purchase_usd)} before tax and fees.
          </AlertDescription>
        </Alert>
      )}
      {preview?.supply_exceeded && (
        <Alert variant="destructive">
          <AlertDescription>
            Only {num(market.units_available)} Royalty Units remain for this book.
          </AlertDescription>
        </Alert>
      )}

      {preview && !preview.below_minimum && !preview.supply_exceeded && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-2 text-sm">
          <Row label="Royalty Units" value={num(preview.units)} />
          <Row label="Ownership" value={pct(preview.ownership_percentage, 4)} />
          <Row label="Unit price" value={usd(preview.unit_price, 4)} />
          <div className="border-t border-border pt-2 space-y-1">
            <Row label="Subtotal" value={usd(preview.subtotal)} />
            <Row label={`Thai VAT (${(market.thai_vat_rate * 100).toFixed(0)}%)`} value={usd(preview.vat)} />
            <Row label={`Payment gateway fee (${(market.gateway_fee_rate * 100).toFixed(0)}%)`} value={usd(preview.gateway_fee)} />
            <Row label="Total payment" value={usd(preview.total)} strong />
          </div>
          <p className="text-[11px] text-muted-foreground pt-1 flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Estimated tax and fees. Final charges may vary according to applicable law and the selected payment provider.
          </p>
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        disabled={disabled || submitting}
        onClick={onReserve}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Reserve Royalty Units
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Payment activation is coming soon. Reserving saves your calculation but does not charge you.
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
