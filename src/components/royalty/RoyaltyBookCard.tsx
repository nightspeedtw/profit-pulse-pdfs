import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usd, num, pct, computePreview } from "@/lib/royalty/math";
import type { RoyaltyBookListing } from "@/lib/royalty/api";

export function RoyaltyBookCard({ book }: { book: RoyaltyBookListing }) {
  const twenty = computePreview(book.market, { usd: 20 });
  const hasHistory = book.trailing_30d_sales_count > 0;
  return (
    <Link
      to={`/royalty/book/${book.book_id}`}
      className="group block"
    >
      <Card className="overflow-hidden hover:border-primary/50 transition-colors">
        <div className="aspect-[4/3] bg-muted overflow-hidden">
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt={book.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
              No cover
            </div>
          )}
        </div>
        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight line-clamp-2">{book.title}</h3>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {(book.market.royalty_pool_percent * 100).toFixed(0)}% pool
            </Badge>
          </div>
          {book.category && (
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{book.category}</div>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 text-xs">
            <Cell label="Unit price" value={usd(book.market.current_indicative_unit_price_usd, 4)} />
            <Cell label="Indicative value" value={usd(book.market.current_indicative_book_value_usd, 0)} />
            <Cell label="Sale price" value={usd(book.price)} />
            <Cell label="Units left" value={num(book.market.units_available)} />
            {twenty && (
              <>
                <Cell label="$20 → units" value={num(twenty.units)} />
                <Cell label="$20 → ownership" value={pct(twenty.ownership_percentage, 3)} />
                <Cell label="Royalty / sale ($20)" value={usd(twenty.one_sale.user_royalty_per_sale, 4)} />
                <Cell label="Break-even ($20)" value={twenty.break_even.total ? `${num(twenty.break_even.total)} sales` : "—"} />
              </>
            )}
          </div>
          {!hasHistory && (
            <p className="text-[11px] text-muted-foreground italic pt-1">
              New book — no verified sales history yet.
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
