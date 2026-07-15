import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatSharePrice, formatUsd } from "@/lib/exchange/model";
import { invoke } from "@/lib/exchange/api";

interface Ask { id: string; price_per_share: number; qty_remaining: number; is_treasury: boolean; }

export function BuyPanel({
  bookId, asks, walletBalance, authed, onDone,
}: {
  bookId: string;
  asks: Ask[];
  walletBalance: number;
  authed: boolean;
  onDone: () => void;
}) {
  const [qty, setQty] = useState("1000");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const q = Math.floor(Number(qty) || 0);
    let remaining = q;
    let cost = 0;
    let lastPrice = 0;
    for (const a of asks) {
      if (remaining <= 0) break;
      const fill = Math.min(remaining, Number(a.qty_remaining));
      cost += fill * Number(a.price_per_share);
      lastPrice = Number(a.price_per_share);
      remaining -= fill;
    }
    return { qty: q - remaining, cost, lastPrice, insufficient: cost > walletBalance };
  }, [qty, asks, walletBalance]);

  const submit = async () => {
    setBusy(true);
    try {
      const q = Math.floor(Number(qty) || 0);
      if (!q) throw new Error("Enter quantity");
      await invoke("exchange-buy", { book_id: bookId, qty: q, max_cost: preview.cost });
      toast.success(`Bought ${preview.qty.toLocaleString()} shares for ${formatUsd(preview.cost)}`);
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
        <h3 className="font-serif text-lg">Buy Shares</h3>
        <span className="text-xs text-muted-foreground">Wallet: {formatUsd(walletBalance)}</span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="buy-qty">Quantity (shares)</Label>
        <Input id="buy-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <div className="text-sm space-y-1 rounded-lg bg-muted/40 p-3">
        <div className="flex justify-between"><span>Fill</span><span className="font-mono">{preview.qty.toLocaleString()} sh</span></div>
        <div className="flex justify-between"><span>Est. avg price</span><span className="font-mono">{preview.qty ? formatSharePrice(preview.cost / preview.qty) : "—"}</span></div>
        <div className="flex justify-between font-semibold"><span>Total cost</span><span className="font-mono">{formatUsd(preview.cost)}</span></div>
      </div>
      {!authed ? (
        <p className="text-xs text-muted-foreground text-center">Sign in to trade.</p>
      ) : preview.insufficient ? (
        <p className="text-xs text-red-600 text-center">Insufficient wallet balance.</p>
      ) : null}
      <Button
        className="w-full"
        disabled={!authed || busy || !preview.qty || preview.insufficient}
        onClick={submit}
      >
        {busy ? "Executing…" : `Buy ${preview.qty.toLocaleString()} shares`}
      </Button>
    </div>
  );
}
