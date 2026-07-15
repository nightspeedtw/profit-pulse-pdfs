import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import { ComplianceBanner } from "@/components/exchange/ComplianceBanner";
import { TopUpModal } from "@/components/exchange/TopUpModal";
import { getMyWallet, getMyWalletTx, invoke } from "@/lib/exchange/api";
import { formatUsd } from "@/lib/exchange/model";
import { Button } from "@/components/ui/button";

const LABELS: Record<string, string> = {
  demo_grant: "Demo grant",
  topup_placeholder: "Top up",
  trade_buy: "Buy",
  trade_sell: "Sell proceeds",
  royalty_credit: "Royalty credit",
  sell_escrow_return: "Cancel refund",
};

export default function ExchangeWallet() {
  const { user, loading } = useAuth();
  const [wallet, setWallet] = useState<any>(null);
  const [tx, setTx] = useState<any[]>([]);
  const [modal, setModal] = useState(false);

  const load = async () => {
    // Auto-grant demo on first visit
    await invoke("exchange-wallet-topup-demo", {}).catch(() => {});
    const [w, t] = await Promise.all([getMyWallet(), getMyWalletTx(100)]);
    setWallet(w); setTx(t);
  };
  useEffect(() => { if (user) load(); }, [user]);

  if (loading) return <main className="container py-12 text-center text-muted-foreground">Loading…</main>;
  if (!user) return <Navigate to="/admin/login?redirect=/exchange/wallet" replace />;

  const balance = Number(wallet?.usd_balance ?? 0);

  return (
    <>
      <Helmet><title>Wallet — Royalty Rights Exchange</title></Helmet>
      <main className="container py-8 space-y-6 max-w-3xl">
        <header className="flex justify-between items-center">
          <h1 className="font-serif text-3xl">Wallet</h1>
          <Button variant="outline" asChild><Link to="/exchange">← Exchange</Link></Button>
        </header>

        <ComplianceBanner />

        <section className="rounded-2xl border border-border p-6 bg-gradient-to-br from-secondary/50 to-transparent">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Available USD (DEMO)</div>
          <div className="font-mono text-4xl mt-2">{formatUsd(balance)}</div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setModal(true)}>Top Up</Button>
            <Button variant="outline" asChild><Link to="/exchange/portfolio">View Portfolio</Link></Button>
          </div>
          {wallet?.is_demo && (
            <p className="text-xs text-muted-foreground mt-3">This is a DEMO balance for evaluating the trading UX. No real funds.</p>
          )}
        </section>

        <section className="rounded-xl border border-border p-4">
          <h2 className="font-serif text-lg mb-3">Transaction history</h2>
          {tx.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="text-sm">
              {tx.map(t => (
                <div key={t.id} className="flex items-center justify-between border-b border-border/40 py-2">
                  <span className="text-xs text-muted-foreground w-40">{new Date(t.created_at).toLocaleString()}</span>
                  <span className="flex-1">{LABELS[t.type] ?? t.type}</span>
                  <span className={`font-mono w-28 text-right ${Number(t.amount_usd) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {Number(t.amount_usd) >= 0 ? "+" : ""}{formatUsd(Number(t.amount_usd))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <TopUpModal open={modal} onOpenChange={setModal} />
      </main>
    </>
  );
}
