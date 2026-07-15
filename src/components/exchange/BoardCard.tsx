import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { formatSharePrice, formatUsd, formatShares, pctChange, SHARES_PER_BOOK } from "@/lib/exchange/model";
import type { Offering } from "@/lib/exchange/api";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export function BoardCard({ o }: { o: Offering }) {
  const last = Number(o.last_trade_price ?? o.ref_price_per_share);
  const change = pctChange(last, Number(o.ref_price_per_share));
  const marketCap = last * SHARES_PER_BOOK;
  const soldPct = 1 - Number(o.treasury_shares) / Number(o.total_shares);

  return (
    <Link to={`/exchange/book/${o.book_id}`}>
      <Card className="p-4 hover:shadow-md transition-shadow flex gap-4 items-center">
        <div className="h-20 w-14 rounded-md overflow-hidden bg-muted flex-shrink-0">
          {o.cover_url ? (
            <img src={o.cover_url} alt={o.title} className="h-full w-full object-cover" loading="lazy" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-serif text-base line-clamp-1">{o.title}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
            {o.book_type === 'kids' ? "Kids Picture Book" : "Adult Ebook"}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">MCap</span>
            <span className="font-mono">{formatUsd(marketCap, { min: 0, max: 0 })}</span>
            <span className="text-muted-foreground ml-2">Sold</span>
            <span className="font-mono">{(soldPct * 100).toFixed(2)}%</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-mono text-base">{formatSharePrice(last)}</div>
          <div className={`text-xs flex items-center justify-end gap-1 mt-1 ${
            change == null ? "text-muted-foreground" :
            change > 0 ? "text-green-600" : change < 0 ? "text-red-600" : "text-muted-foreground"
          }`}>
            {change == null ? <Minus className="h-3 w-3" /> : change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {change == null ? "—" : `${(change * 100).toFixed(2)}%`}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {formatShares(Number(o.treasury_shares))} in treasury
          </div>
        </div>
      </Card>
    </Link>
  );
}
