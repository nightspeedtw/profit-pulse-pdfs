import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatSharePrice, formatUsd, formatShares } from "@/lib/exchange/model";
import { invoke } from "@/lib/exchange/api";

export function SellPanel({
  bookId, myShares, refPrice, authed, onDone,
}: {
  bookId: string;
  myShares: number;
  refPrice: number;
  authed: boolean;
  onDone: () => void;
}) {
  const [qty, setQty] = useState("100");
  const [price, setPrice] = useState(refPrice.toFixed(6));
  const [busy, setBusy] = useState(false);

  const q = Math.floor(Number(qty) || 0);
  const p = Number(price) || 0;
  const total = q * p;
  const insufficient = q > myShares;

  const submit = async () => {
    setBusy(true);
    try {
      await invoke("exchange-sell-list", { book_id: bookId, qty: q, price_per_share: p });
      toast.success(`Listed ${q.toLocaleString()} shares @ ${formatSharePrice(p)}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg">Sell / List Ask</h3>
        <span className="text-xs text-muted-foreground">You own: {formatShares(myShares)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sell-qty">Quantity</Label>
          <Input id="sell-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sell-price">Price / share</Label>
          <Input id="sell-price" type="number" step="0.000001" min={0.0001} value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div className="text-sm rounded-lg bg-muted/40 p-3 flex justify-between">
        <span>Expected proceeds if fully filled</span>
        <span className="font-mono">{formatUsd(total)}</span>
      </div>
      {insufficient && <p className="text-xs text-red-600">You don't own enough shares.</p>}
      <Button
        className="w-full"
        variant="secondary"
        disabled={!authed || busy || !q || insufficient || !p}
        onClick={submit}
      >
        {busy ? "Listing…" : "List sell order"}
      </Button>
      {!authed && <p className="text-xs text-muted-foreground text-center">Sign in to trade.</p>}
    </div>
  );
}
