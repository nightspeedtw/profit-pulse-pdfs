import { formatSharePrice, formatShares, formatUsd } from "@/lib/exchange/model";

interface Ask { id: string; price_per_share: number; qty_remaining: number; is_treasury: boolean; }

export function OrderBook({ asks }: { asks: Ask[] }) {
  if (!asks.length) {
    return <div className="text-sm text-muted-foreground p-4 text-center">No open sell orders.</div>;
  }
  return (
    <div className="text-xs font-mono">
      <div className="grid grid-cols-4 gap-2 text-muted-foreground pb-2 border-b border-border">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
        <span className="text-right">By</span>
      </div>
      {asks.map(a => (
        <div key={a.id} className="grid grid-cols-4 gap-2 py-1 border-b border-border/40 last:border-0">
          <span className="text-red-600">{formatSharePrice(Number(a.price_per_share))}</span>
          <span className="text-right">{formatShares(Number(a.qty_remaining))}</span>
          <span className="text-right">{formatUsd(Number(a.price_per_share) * Number(a.qty_remaining), { min: 0, max: 2 })}</span>
          <span className="text-right text-muted-foreground">{a.is_treasury ? "Treasury" : "User"}</span>
        </div>
      ))}
    </div>
  );
}
