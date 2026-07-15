import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { listOfferings, type Offering, invoke } from "@/lib/exchange/api";
import { ComplianceBanner } from "@/components/exchange/ComplianceBanner";
import { BoardCard } from "@/components/exchange/BoardCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatUsd, SHARES_PER_BOOK } from "@/lib/exchange/model";
import { useAuth } from "@/hooks/useAuth";

export default function Exchange() {
  const { user } = useAuth();
  const [offs, setOffs] = useState<Offering[]>([]);
  const [sort, setSort] = useState<"newest" | "mcap" | "movers">("newest");
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    listOfferings().then(setOffs).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []);

  // Demo grant on first visit for authed users
  useEffect(() => {
    if (user) invoke("exchange-wallet-topup-demo", {}).catch(() => {});
  }, [user]);

  const sorted = useMemo(() => {
    const arr = [...offs];
    if (sort === "newest") arr.sort((a, b) => +new Date(b.listed_at) - +new Date(a.listed_at));
    if (sort === "mcap") arr.sort((a, b) =>
      Number(b.last_trade_price ?? b.ref_price_per_share) - Number(a.last_trade_price ?? a.ref_price_per_share));
    if (sort === "movers") arr.sort((a, b) => Number(b.volume_24h_usd) - Number(a.volume_24h_usd));
    return arr;
  }, [offs, sort]);

  const totalMcap = offs.reduce((s, o) => s + Number(o.last_trade_price ?? o.ref_price_per_share) * SHARES_PER_BOOK, 0);
  const totalVol = offs.reduce((s, o) => s + Number(o.volume_24h_usd), 0);

  return (
    <>
      <Helmet>
        <title>Royalty Rights Exchange — Trade Book Royalty Shares | SecretPDF</title>
        <meta name="description" content="Buy and sell royalty shares of published picture books and ebooks. Transparent formula, live order book, demo wallet." />
      </Helmet>
      <main className="container py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl">Royalty Rights Exchange</h1>
            <p className="text-muted-foreground mt-1">กระดานเทรดลิขสิทธิ์ — buy and sell royalty shares of published books.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/exchange/wallet">Wallet</Link></Button>
            <Button asChild><Link to="/exchange/portfolio">Portfolio</Link></Button>
          </div>
        </header>

        <ComplianceBanner />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Books listed" value={String(offs.length)} />
          <StatTile label="Total market cap" value={formatUsd(totalMcap, { min: 0, max: 0 })} />
          <StatTile label="24h volume" value={formatUsd(totalVol, { min: 2, max: 2 })} />
          <StatTile label="Shares per book" value={SHARES_PER_BOOK.toLocaleString()} />
        </div>

        <div className="flex justify-between items-center">
          <Tabs value={sort} onValueChange={(v) => setSort(v as any)}>
            <TabsList>
              <TabsTrigger value="newest">Newest</TabsTrigger>
              <TabsTrigger value="mcap">Market Cap</TabsTrigger>
              <TabsTrigger value="movers">24h Volume</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {loading ? (
          <div className="text-muted-foreground text-center py-16">Loading exchange…</div>
        ) : sorted.length === 0 ? (
          <div className="text-muted-foreground text-center py-16">No offerings listed yet.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {sorted.map(o => <BoardCard key={o.book_id} o={o} />)}
          </div>
        )}
      </main>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl">{value}</div>
    </div>
  );
}
