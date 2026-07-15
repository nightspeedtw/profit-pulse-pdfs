import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  getOffering, getRecentTrades, getPriceHistory, getBuyFeeSettings, getBookSalesCount,
  getMyWallet, getMyHoldings, getMyRoyalties, type Offering, type BuyFeeSettings,
} from "@/lib/exchange/api";
import { ComplianceBanner } from "@/components/exchange/ComplianceBanner";
import { PriceChart } from "@/components/exchange/PriceChart";
import { BuyPanel } from "@/components/exchange/BuyPanel";
import { RoyaltyCalculator } from "@/components/exchange/RoyaltyCalculator";
import { formatSharePrice, formatShares, formatUsd, formatPct, SHARES_PER_BOOK } from "@/lib/exchange/model";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export default function ExchangeBook() {
  const { bookId = "" } = useParams();
  const { user } = useAuth();
  const [off, setOff] = useState<Offering | null>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [wallet, setWallet] = useState<any>(null);
  const [myShares, setMyShares] = useState<number>(0);
  const [myRoyalties, setMyRoyalties] = useState<number>(0);
  const [salesCount, setSalesCount] = useState<number>(0);
  const [fees, setFees] = useState<BuyFeeSettings>({ min_usd: 20, gateway_fee_pct: 0.05, tax_pct: 0.07 });

  const load = useCallback(async () => {
    const [o, t, h, f, sc] = await Promise.all([
      getOffering(bookId), getRecentTrades(bookId), getPriceHistory(bookId),
      getBuyFeeSettings(), getBookSalesCount(bookId),
    ]);
    setOff(o); setTrades(t); setHistory(h); setFees(f); setSalesCount(sc);
    if (user) {
      const [w, holdings, roys] = await Promise.all([
        getMyWallet(), getMyHoldings(), getMyRoyalties(200),
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
  const refPrice = Number(off.ref_price_per_share);
  const mcap = last * SHARES_PER_BOOK;
  const soldPct = 1 - Number(off.treasury_shares) / Number(off.total_shares);

  return (
    <>
      <Helmet>
        <title>{off.title} — Royalty Rights | SecretPDF Exchange</title>
        <meta name="description" content={`Buy lifetime royalty shares of "${off.title}". Transparent formula, live calculator.`} />
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
              <Stat label="Share price" value={formatSharePrice(refPrice)} mono />
              <Stat label="Market Cap" value={formatUsd(mcap, { min: 0, max: 0 })} mono />
              <Stat label="Books sold" value={String(salesCount)} mono />
              <Stat label="Shares available" value={formatPct(Number(off.treasury_shares) / Number(off.total_shares), 2)} mono />
              <Stat label="Sold %" value={formatPct(soldPct, 2)} mono />
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

            <RoyaltyCalculator
              refPrice={refPrice}
              feePct={fees.gateway_fee_pct}
              taxPct={fees.tax_pct}
              minUsd={fees.min_usd}
            />

            <section className="rounded-xl border border-border p-4">
              <h2 className="font-serif text-lg mb-3">Recent Purchases</h2>
              {trades.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchases yet — be the first.</p>
              ) : (
                <div className="text-xs font-mono">
                  <div className="grid grid-cols-4 gap-2 text-muted-foreground pb-2 border-b border-border">
                    <span>Time</span><span className="text-right">Shares</span><span className="text-right">Price</span><span className="text-right">Total</span>
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
                <div className="flex justify-between"><span>Shares owned</span><span className="font-mono">{formatShares(myShares)}</span></div>
                <div className="flex justify-between"><span>Ownership</span><span className="font-mono">{formatPct(myShares / SHARES_PER_BOOK, 4)}</span></div>
                <div className="flex justify-between"><span>Current value</span><span className="font-mono">{formatUsd(myShares * refPrice)}</span></div>
                <div className="flex justify-between"><span>Royalties received</span><span className="font-mono">{formatUsd(myRoyalties)}</span></div>
              </div>
            )}
            <BuyPanel
              bookId={bookId}
              refPrice={refPrice}
              walletBalance={Number(wallet?.usd_balance ?? 0)}
              authed={!!user}
              minUsd={fees.min_usd}
              feePct={fees.gateway_fee_pct}
              taxPct={fees.tax_pct}
              onDone={load}
            />
            {!user && (
              <Button asChild className="w-full"><Link to="/admin/login">Sign in to buy</Link></Button>
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
