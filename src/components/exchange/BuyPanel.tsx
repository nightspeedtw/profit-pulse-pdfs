import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatSharePrice, formatShares, formatUsd, formatPct, quoteBuy } from "@/lib/exchange/model";
import { invoke } from "@/lib/exchange/api";

export function BuyPanel({
  bookId, refPrice, walletBalance, authed, minUsd, feePct, taxPct, onDone,
}: {
  bookId: string;
  refPrice: number;
  walletBalance: number;
  authed: boolean;
  minUsd: number;
  feePct: number;
  taxPct: number;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(minUsd));
  const [busy, setBusy] = useState(false);

  const amt = Number(amount) || 0;
  const q = useMemo(() => quoteBuy(amt, refPrice, feePct, taxPct), [amt, refPrice, feePct, taxPct]);
  const belowMin = amt < minUsd;
  const insufficient = amt > walletBalance;

  const submit = async () => {
    setBusy(true);
    try {
      if (belowMin) throw new Error(`Minimum ${formatUsd(minUsd, { min: 0, max: 0 })} per order`);
      await invoke("exchange-buy", { book_id: bookId, amount_usd: amt });
      toast.success(`Bought ${formatShares(q.shares)} shares (${formatUsd(amt)} gross)`);
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
        <h3 className="font-serif text-lg">ซื้อหุ้น · Buy Shares</h3>
        <span className="text-xs text-muted-foreground">Wallet: {formatUsd(walletBalance)}</span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="buy-amount">ยอดลงทุน (USD, min {formatUsd(minUsd, { min: 0, max: 0 })})</Label>
        <Input
          id="buy-amount" type="number" min={minUsd} step={1}
          value={amount} onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="text-sm space-y-1 rounded-lg bg-muted/40 p-3">
        <div className="flex justify-between text-muted-foreground"><span>ค่าธรรมเนียม ({formatPct(feePct,1)})</span><span className="font-mono">− {formatUsd(q.fee)}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>ภาษี ({formatPct(taxPct,1)})</span><span className="font-mono">− {formatUsd(q.tax)}</span></div>
        <div className="flex justify-between"><span>สุทธิ</span><span className="font-mono">{formatUsd(q.net)}</span></div>
        <div className="flex justify-between"><span>ราคาต่อหุ้น</span><span className="font-mono">{formatSharePrice(refPrice)}</span></div>
        <div className="flex justify-between font-semibold text-primary"><span>หุ้นที่ได้</span><span className="font-mono">{formatShares(q.shares)}</span></div>
        <div className="flex justify-between text-xs text-muted-foreground"><span>ความเป็นเจ้าของ</span><span className="font-mono">{formatPct(q.ownershipPct, 4)}</span></div>
      </div>
      {!authed ? (
        <p className="text-xs text-muted-foreground text-center">Sign in to buy.</p>
      ) : belowMin ? (
        <p className="text-xs text-red-600 text-center">ขั้นต่ำ {formatUsd(minUsd, { min: 0, max: 0 })} ต่อคำสั่งซื้อ</p>
      ) : insufficient ? (
        <p className="text-xs text-red-600 text-center">ยอดในกระเป๋าไม่พอ · Insufficient wallet balance</p>
      ) : null}
      <Button
        className="w-full"
        disabled={!authed || busy || belowMin || insufficient || !q.shares}
        onClick={submit}
      >
        {busy ? "กำลังดำเนินการ…" : `ซื้อ ${formatShares(q.shares)} หุ้น (${formatUsd(amt)})`}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
        Phase 1: ซื้อหุ้นถือลิขสิทธิ์ตลอดชีพ · ยังไม่มีระบบขายคืน · ระบบทดลอง (DEMO) ยังไม่รับเงินจริง
      </p>
    </div>
  );
}
