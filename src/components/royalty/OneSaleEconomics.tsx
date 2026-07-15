import { computePreview, usd, num, pct, type MarketRow } from "@/lib/royalty/math";

/**
 * "If this book sells once" — dynamic preview at the current
 * book_sale_price and the ownership implied by the calculator.
 */
export function OneSaleEconomics({
  market,
  units,
}: { market: MarketRow; units: number }) {
  const preview = computePreview(market, { units });
  if (!preview) return null;
  const os = preview.one_sale;
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-2 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        If this book sells once
      </div>
      <div className="space-y-1 text-muted-foreground">
        <Row label="Book sale price" value={usd(os.gross)} />
        <Row label={`Sales VAT (${(market.sales_vat_rate * 100).toFixed(0)}%)`} value={`− ${usd(os.sale_vat)}`} />
        <Row label={`Gateway fee (${(market.sales_gateway_fee_rate * 100).toFixed(0)}%)`} value={`− ${usd(os.sale_gateway_fee)}`} />
        <Row label="Net revenue" value={usd(os.net_sale_revenue)} strong />
        <Row label={`Distributable royalty pool (${(market.royalty_pool_percent * 100).toFixed(0)}% of net)`} value={usd(os.distributable_royalty)} />
      </div>
      <div className="border-t border-border pt-2 space-y-1">
        <Row label="Your ownership" value={pct(preview.ownership_percentage, 4)} />
        <Row label="Your royalty from this sale" value={usd(os.user_royalty_per_sale, 4)} strong />
      </div>
    </div>
  );
}

export function BreakEvenBox({ market, units }: { market: MarketRow; units: number }) {
  const preview = computePreview(market, { units });
  if (!preview) return null;
  const { subtotal, total, break_even } = preview;
  const royalty = preview.one_sale.user_royalty_per_sale;
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-2 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Estimated Break-Even
      </div>
      <Row
        label="Sales to recover subtotal"
        value={royalty > 0 ? `${num(break_even.subtotal)} sales · ${usd(subtotal)}` : "—"}
      />
      <Row
        label="Sales to recover total (incl. estimated tax & fees)"
        value={royalty > 0 ? `${num(break_even.total)} sales · ${usd(total)}` : "—"}
      />
      <p className="text-[11px] text-muted-foreground pt-1">
        This is an estimate based on the current book price, fee settings, royalty pool, and ownership percentage. Sales and payouts are not guaranteed.
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
