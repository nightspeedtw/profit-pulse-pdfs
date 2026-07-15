import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  getOffering, getAsks, getRecentTrades, getPriceHistory,
  getMyWallet, getMyHoldings, getMyRoyalties, type Offering,
} from "@/lib/exchange/api";
import { ComplianceBanner } from "@/components/exchange/ComplianceBanner";
import { OrderBook } from "@/components/exchange/OrderBook";
import { PriceChart } from "@/components/exchange/PriceChart";
import { BuyPanel } from "@/components/exchange/BuyPanel";
import { SellPanel } from "@/components/exchange/SellPanel";
import { formatSharePrice, formatShares, formatUsd, SHARES_PER_BOOK } from "@/lib/exchange/model";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export default function ExchangeBook() {
  const { bookId = "" } = useParams();
  const { user } = useAuth();
  const [off, setOff] = useState<Offering | null>(null);
  const [asks, setAsks] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [wallet, setWallet] = useState<any>(null);
  const [myShares, setMyShares] = useState<number>(0);
  const [myRoyalties, setMyRoyalties] = useState<number>(0);

  const load = useCallback(async () => {
    const [o, a, t, h] = await Promise.all([
      getOffering(bookId), getAsks(bookId), getRecentTrades(bookId), getPriceHistory(bookId),
    ]);
    setOff(o); setAsks(a); setTrades(t); setHistory(h);
    if (user) {
      const [w, holdings, roys] = await Promise.all([
        getMyWallet(),
        getMyHoldings(),
        getMyRoyalties(200),
      ]);
      setWallet(w);
      const mine = (holdings ?? []).find((x: any) => x.book_id === bookId);
      setMyShares(mine ? Number(mine.shares) : 0);
      const total = (roys ?? []).filter((r: any) => r.book_id === bookId).reduce((s: number, r: any) => s + Number(r.amount_usd), 0);
      setMyRoyalties(total);
    } else {
      setWallet(null); setMyShares(0); setMyRoyalties(0);
    }
  }, [bookId, user]);

  useEffect(() => { load(); }, [load]);

  if (!off) {
    return <main className="container py-12 text-center text-muted-foreground">Loading…</main>;
  }

  const last = Number(off.last_trade_price ?? off.ref_price_per_share);
  const mcap = last * SHARES_PER_BOOK;

  return (
    <>
      <Helmet>
        <title>{off.title} — Royalty Rights | SecretPDF Exchange</title>
        <meta name="description" content={`Trade royalty shares of "${off.title}". Live order book, transparent pricing.`} />
      </Helmet>
      <main className="container py-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/exchange" className="hover:underline">← Exchange</Link>
        </div>

        <header className="flex flex-wrap gap-4 items-center">
          <div className="h-28 w-20 rounded-md overflow-hidden bg-muted flex-shrink-0">
            {off.cover_url && <img src={off.cover_url} alt={off.title} className="h-full w-full object-cover" />}
          </div>
          <div className="flex-1 min-w-[240px]">
            <h1 className="font-serif text-3xl">{off.title}</h1>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
              {off.book_type === "kids" ? "Kids Picture Book" : "Adult Ebook"}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <Stat label="Last" value={formatSharePrice(last)} mono />
              <Stat label="Ref" value={formatSharePrice(Number(off.ref_price_per_share))} mono />
              <Stat label="Market Cap" value={formatUsd(mcap, { min: 0, max: 0 })} mono />
              <Stat label="24h Vol" value={formatUsd(Number(off.volume_24h_usd))} mono />
              <Stat label="Treasury" value={formatShares(Number(off.treasury_shares))} mono />
            </div>
          </div>
        </header>

        <ComplianceBanner />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <section className="rounded-xl border border-border p-4">
              <h2 className="font-serif text-lg mb-3">Price History</h2>
              <PriceChart data={history} />
            </section>
            <section className="rounded-xl border border-border p-4">
              <h2 className="font-serif text-lg mb-3">Order Book — Asks</h2>
              <OrderBook asks={asks} />
            </section>
            <section className="rounded-xl border border-border p-4">
              <h2 className="font-serif text-lg mb-3">Recent Trades</h2>
              {trades.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trades yet — be the first.</p>
              ) : (
                <div className="text-xs font-mono">
                  <div className="grid grid-cols-4 gap-2 text-muted-foreground pb-2 border-b border-border">
                    <span>Time</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Value</span>
                  </div>
                  {trades.map(t => (
                    <div key={t.id} className="grid grid-cols-4 gap-2 py-1 border-b border-border/40 last:border-0">
                      <span>{new Date(t.executed_at).toLocaleTimeString()}</span>
                      <span className="text-right">{formatShares(Number(t.qty))}</span>
                      <span className="text-right">{formatSharePrice(Number(t.price_per_share))}</span>
                      <span className="text-right">{formatUsd(Number(t.gross_usd))}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            {user && (
              <div className="rounded-xl border border-border p-4 space-y-1 text-sm">
                <div className="font-serif text-lg mb-2">Your Position</div>
                <div className="flex justify-between"><span>Shares</span><span className="font-mono">{formatShares(myShares)}</span></div>
                <div className="flex justify-between"><span>Current value</span><span className="font-mono">{formatUsd(myShares * last)}</span></div>
                <div className="flex justify-between"><span>Royalties received</span><span className="font-mono">{formatUsd(myRoyalties)}</span></div>
              </div>
            )}
            <BuyPanel
              bookId={bookId}
              asks={asks}
              walletBalance={Number(wallet?.usd_balance ?? 0)}
              authed={!!user}
              onDone={load}
            />
            <SellPanel
              bookId={bookId}
              myShares={myShares}
              refPrice={Number(off.ref_price_per_share)}
              authed={!!user}
              onDone={load}
            />
            {!user && (
              <Button asChild className="w-full"><Link to="/admin/login">Sign in to trade</Link></Button>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value}</div>
    </div>
  );
}
