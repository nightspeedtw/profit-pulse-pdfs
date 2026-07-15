import { useQuery } from "@tanstack/react-query";
import { listMyHoldings, listRoyaltyBooks } from "@/lib/royalty/api";
import { Card } from "@/components/ui/card";
import { RoyaltyDisclaimers } from "@/components/royalty/RoyaltyDisclaimers";
import { usd, num, pct, computePreview } from "@/lib/royalty/math";
import { Link } from "react-router-dom";
import { useEffect } from "react";

export default function MyRoyalties() {
  useEffect(() => { document.title = "My Royalties — SecretPDF"; }, []);
  const { data: holdings = [] } = useQuery({ queryKey: ["my-royalty-holdings"], queryFn: listMyHoldings });
  const { data: books = [] } = useQuery({ queryKey: ["royalty-books"], queryFn: listRoyaltyBooks });
  const byId = new Map(books.map((b) => [b.book_id, b]));

  const totals = holdings.reduce((acc, h) => {
    const b = byId.get(h.book_id);
    const currentValue = b ? h.units_owned * b.market.current_indicative_unit_price_usd : 0;
    acc.units += h.units_owned;
    acc.paid += h.total_paid_usd;
    acc.indicative += currentValue;
    acc.lifetime += h.lifetime_royalty_earned;
    acc.pending += h.pending_royalty;
    return acc;
  }, { units: 0, paid: 0, indicative: 0, lifetime: 0, pending: 0 });

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-3xl font-bold">My Royalties</h1>
      <p className="text-muted-foreground mt-1">Your Royalty Ownership across all books.</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
        <Stat label="Books held" value={num(holdings.length)} />
        <Stat label="Total Royalty Units" value={num(totals.units)} />
        <Stat label="Total cost" value={usd(totals.paid)} />
        <Stat label="Indicative value" value={usd(totals.indicative)} note="Estimate" />
        <Stat label="Lifetime royalty earned" value={usd(totals.lifetime)} />
      </div>

      <div className="mt-8 space-y-3">
        {holdings.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            You don't hold any Royalty Units yet. <Link className="underline" to="/royalty">Browse books →</Link>
          </Card>
        ) : (
          holdings.map((h) => {
            const b = byId.get(h.book_id);
            const currentUnitPrice = b?.market.current_indicative_unit_price_usd ?? 0;
            const currentValue = h.units_owned * currentUnitPrice;
            const oneSale = b ? computePreview(b.market, { units: h.units_owned })?.one_sale : null;
            return (
              <Card key={h.book_id} className="p-4">
                <div className="grid md:grid-cols-4 gap-4 items-start">
                  <div className="md:col-span-2">
                    <Link to={`/royalty/book/${h.book_id}`} className="font-semibold hover:underline">
                      {b?.title ?? h.book_id}
                    </Link>
                    <div className="text-xs text-muted-foreground mt-1">{pct(h.ownership_percentage, 4)} ownership</div>
                    <div className="text-sm mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                      <span>Units</span><span className="tabular-nums text-foreground">{num(h.units_owned)}</span>
                      <span>Avg cost / unit</span><span className="tabular-nums">{usd(h.average_unit_cost, 4)}</span>
                      <span>Subtotal invested</span><span className="tabular-nums">{usd(h.subtotal_invested_usd)}</span>
                      <span>Total VAT paid</span><span className="tabular-nums">{usd(h.total_vat_usd)}</span>
                      <span>Total gateway fees</span><span className="tabular-nums">{usd(h.total_gateway_fee_usd)}</span>
                      <span>Total paid</span><span className="tabular-nums text-foreground font-medium">{usd(h.total_paid_usd)}</span>
                    </div>
                  </div>
                  <div className="text-sm space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Current</div>
                    <div>Unit price: <span className="tabular-nums">{usd(currentUnitPrice, 4)}</span></div>
                    <div>Holding value: <span className="tabular-nums font-medium">{usd(currentValue)}</span></div>
                    {oneSale && (
                      <div>Royalty / future sale: <span className="tabular-nums">{usd(oneSale.user_royalty_per_sale, 4)}</span></div>
                    )}
                  </div>
                  <div className="text-sm space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Royalties</div>
                    <div>Lifetime earned: <span className="tabular-nums font-medium">{usd(h.lifetime_royalty_earned)}</span></div>
                    <div>Pending: <span className="tabular-nums">{usd(h.pending_royalty)}</span></div>
                    <div className="text-xs text-muted-foreground italic mt-2">Resale is not available in the current phase.</div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <div className="mt-8"><RoyaltyDisclaimers /></div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {note && <div className="text-[10px] text-muted-foreground mt-1">{note}</div>}
    </Card>
  );
}
