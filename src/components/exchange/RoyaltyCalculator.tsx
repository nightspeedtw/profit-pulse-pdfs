import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import {
  formatUsd, formatShares, formatPct, quoteBuy, SHARES_PER_BOOK,
} from "@/lib/exchange/model";

export function RoyaltyCalculator({
  refPrice,
  feePct,
  taxPct,
  minUsd,
  defaultBookPrice = 4.99,
}: {
  refPrice: number;
  feePct: number;
  taxPct: number;
  minUsd: number;
  defaultBookPrice?: number;
}) {
  const [amount, setAmount] = useState(String(minUsd));
  const [bookPrice, setBookPrice] = useState(defaultBookPrice.toFixed(2));

  const amt = Number(amount) || 0;
  const bp = Number(bookPrice) || 0;

  const q = useMemo(() => quoteBuy(amt, refPrice, feePct, taxPct), [amt, refPrice, feePct, taxPct]);
  const belowMin = amt > 0 && amt < minUsd;

  const perSale = q.payoutPerSale(bp);
  const breakEven = q.breakEvenSales(bp);

  const projections = [100, 500, 1_000, 10_000].map(n => ({
    n, total: perSale * n,
  }));

  return (
    <section className="rounded-xl border border-border p-4 space-y-4 bg-gradient-to-br from-primary/5 to-transparent">
      <div>
        <h2 className="font-serif text-xl">เครื่องคำนวณผลตอบแทน · Royalty Calculator</h2>
        <p className="text-xs text-muted-foreground mt-1">
          คำนวณสด ๆ ตามจำนวนเงินที่คุณลงทุน · ราคาต่อเล่มปรับได้
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="calc-amount">ยอดลงทุน (USD)</Label>
          <Input
            id="calc-amount" type="number" min={minUsd} step={1}
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
          {belowMin && (
            <p className="text-xs text-red-600">ขั้นต่ำ {formatUsd(minUsd, { min: 0, max: 0 })} ต่อคำสั่งซื้อ</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calc-bookprice">ราคาต่อเล่ม (USD)</Label>
          <Input
            id="calc-bookprice" type="number" min={0.99} step={0.5}
            value={bookPrice} onChange={(e) => setBookPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg bg-background/60 p-3 text-sm space-y-1.5 border border-border/60">
        <Row label="ยอดซื้อ" value={formatUsd(q.gross)} />
        <Row label={`ค่าธรรมเนียมชำระเงิน (${formatPct(feePct, 1)})`} value={`− ${formatUsd(q.fee)}`} muted />
        <Row label={`ภาษี (${formatPct(taxPct, 1)})`} value={`− ${formatUsd(q.tax)}`} muted />
        <Row label="สุทธิเข้าซื้อหุ้น" value={formatUsd(q.net)} bold />
        <div className="border-t border-border/60 my-2" />
        <Row label="หุ้นที่ได้" value={formatShares(q.shares)} bold />
        <Row label="% ความเป็นเจ้าของหนังสือ" value={formatPct(q.ownershipPct, 4)} />
        <Row label="ราคาต่อหุ้นปัจจุบัน" value={formatUsd(q.price, { min: 4, max: 6 })} muted />
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="text-sm">
          <div className="flex justify-between">
            <span>รายได้ต่อการขาย 1 เล่ม (ที่ {formatUsd(bp)})</span>
            <span className="font-mono font-semibold">{formatUsd(perSale, { min: 4, max: 6 })}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="font-semibold">ต้องขายกี่เล่มจึงคืนทุน (Break-even)</span>
            <span className="font-mono font-bold text-primary">
              {isFinite(breakEven) ? `~${Math.ceil(breakEven).toLocaleString()} เล่ม` : "—"}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          หมายเหตุ: การคำนวณนี้ไม่รวมมูลค่าหุ้นที่อาจเพิ่มขึ้นเมื่อยอดขายโต ถ้าซื้อได้ต่ำกว่าราคาอ้างอิงในอนาคต จุดคืนทุนจะสั้นลงกว่านี้
        </p>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          ตัวอย่างการคำนวณ · ไม่ใช่การรับประกัน
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {projections.map(p => (
            <div key={p.n} className="rounded-md border border-border/60 p-2 text-center">
              <div className="text-[11px] text-muted-foreground">{p.n.toLocaleString()} เล่มขายรวม</div>
              <div className="font-mono text-sm mt-1">{formatUsd(p.total)}</div>
            </div>
          ))}
        </div>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          ดูวิธีคำนวณ <ChevronDown className="h-3 w-3" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 font-mono bg-muted/40 rounded p-3">
          <div>fee   = gross × {feePct}</div>
          <div>tax   = gross × {taxPct}</div>
          <div>net   = gross − fee − tax</div>
          <div>shares = floor(net / ref_price)</div>
          <div>own_% = shares / {SHARES_PER_BOOK.toLocaleString()}</div>
          <div>payout_per_sale = book_price × (1 − fee_pct − tax_pct) × own_%</div>
          <div>break_even_units = gross / payout_per_sale</div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className={`font-mono ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
