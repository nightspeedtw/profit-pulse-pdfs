import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { ComplianceBanner } from "@/components/exchange/ComplianceBanner";
import {
  getMyHoldings, getMyOpenOrders, getMyRoyalties, invoke,
} from "@/lib/exchange/api";
import { formatSharePrice, formatShares, formatUsd } from "@/lib/exchange/model";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ExchangePortfolio() {
  const { user, loading } = useAuth();
  const [holdings, setHoldings] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [royalties, setRoyalties] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    Promise.all([getMyHoldings(), getMyOpenOrders(), getMyRoyalties(100)]).then(([h, o, r]) => {
      setHoldings(h); setOrders(o); setRoyalties(r);
    });
  };
  useEffect(() => { if (user) load(); }, [user]);

  if (loading) return <main className="container py-12 text-center text-muted-foreground">Loading…</main>;
  if (!user) return <Navigate to="/admin/login?redirect=/exchange/portfolio" replace />;

  const totalValue = holdings.reduce((s, h) => {
    const price = Number(h.rights_offerings.last_trade_price ?? h.rights_offerings.ref_price_per_share);
    return s + Number(h.shares) * price;
  }, 0);
  const totalCost = holdings.reduce((s, h) => s + Number(h.shares) * Number(h.avg_cost_per_share), 0);
  const totalRoyalties = royalties.reduce((s, r) => s + Number(r.amount_usd), 0);

  return (
    <>
      <Helmet><title>Portfolio — Royalty Rights Exchange</title></Helmet>
      <main className="container py-8 space-y-6">
        <header className="flex justify-between items-center">
          <h1 className="font-serif text-3xl">Your Portfolio</h1>
          <Button variant="outline" asChild><Link to="/exchange">← Exchange</Link></Button>
        </header>

        <ComplianceBanner />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Positions" value={String(holdings.length)} />
          <Tile label="Portfolio value" value={formatUsd(totalValue)} />
          <Tile label="Unrealized P/L" value={formatUsd(totalValue - totalCost)} accent={totalValue - totalCost} />
          <Tile label="Royalties earned" value={formatUsd(totalRoyalties)} />
        </div>

        <section className="rounded-xl border border-border p-4">
          <h2 className="font-serif text-lg mb-3">Holdings</h2>
          {holdings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No holdings yet. Browse the <Link className="underline" to="/exchange">exchange</Link>.</p>
          ) : (
            <div className="text-sm">
              <div className="grid grid-cols-6 gap-2 text-xs uppercase tracking-wider text-muted-foreground pb-2 border-b border-border">
                <span className="col-span-2">Book</span>
                <span className="text-right">Shares</span>
                <span className="text-right">Avg cost</span>
                <span className="text-right">Last</span>
                <span className="text-right">Value</span>
              </div>
              {holdings.map(h => {
                const last = Number(h.rights_offerings.last_trade_price ?? h.rights_offerings.ref_price_per_share);
                return (
                  <Link to={`/exchange/book/${h.book_id}`} key={h.book_id} className="grid grid-cols-6 gap-2 py-2 border-b border-border/40 hover:bg-muted/30">
                    <span className="col-span-2 truncate">{h.rights_offerings.title}</span>
                    <span className="text-right font-mono">{formatShares(Number(h.shares))}</span>
                    <span className="text-right font-mono">{formatSharePrice(Number(h.avg_cost_per_share))}</span>
                    <span className="text-right font-mono">{formatSharePrice(last)}</span>
                    <span className="text-right font-mono">{formatUsd(Number(h.shares) * last)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border p-4">
          <h2 className="font-serif text-lg mb-3">Open Sell Orders</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open orders.</p>
          ) : (
            <div className="text-sm space-y-1">
              {orders.map(o => (
                <div key={o.id} className="flex items-center justify-between border-b border-border/40 py-2">
                  <span className="flex-1 truncate">{o.rights_offerings.title}</span>
                  <span className="font-mono w-24 text-right">{formatShares(Number(o.qty_remaining))}</span>
                  <span className="font-mono w-32 text-right">@ {formatSharePrice(Number(o.price_per_share))}</span>
                  <Button
                    variant="ghost" size="sm" disabled={busyId === o.id}
                    onClick={async () => {
                      setBusyId(o.id);
                      try {
                        await invoke("exchange-cancel-order", { order_id: o.id });
                        toast.success("Order cancelled");
                        load();
                      } catch (e) { toast.error((e as Error).message); }
                      finally { setBusyId(null); }
                    }}
                  >Cancel</Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border p-4">
          <h2 className="font-serif text-lg mb-3">Royalty Income</h2>
          {royalties.length === 0 ? (
            <p className="text-sm text-muted-foreground">No royalty distributions received yet.</p>
          ) : (
            <div className="text-sm">
              {royalties.map(r => (
                <div key={r.id} className="flex items-center justify-between border-b border-border/40 py-2">
                  <span className="flex-1 truncate">{r.rights_offerings.title}</span>
                  <span className="text-muted-foreground text-xs w-40">{new Date(r.created_at).toLocaleString()}</span>
                  <span className="font-mono w-28 text-right">{formatShares(Number(r.shares_at_snapshot))} sh</span>
                  <span className="font-mono w-24 text-right text-green-600">+{formatUsd(Number(r.amount_usd))}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: number }) {
  const color = accent == null ? "" : accent >= 0 ? "text-green-600" : "text-red-600";
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-xl ${color}`}>{value}</div>
    </div>
  );
}
