import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRoyaltyBook } from "@/lib/royalty/api";
import { PurchaseCalculator } from "@/components/royalty/PurchaseCalculator";
import { OneSaleEconomics, BreakEvenBox } from "@/components/royalty/OneSaleEconomics";
import { RoyaltyDisclaimers } from "@/components/royalty/RoyaltyDisclaimers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usd, num, pct, computePreview } from "@/lib/royalty/math";
import { useEffect, useMemo, useState } from "react";

export default function RoyaltyBook() {
  const { bookId = "" } = useParams();
  const { data: book, isLoading } = useQuery({
    queryKey: ["royalty-book", bookId],
    queryFn: () => getRoyaltyBook(bookId),
    enabled: !!bookId,
  });

  useEffect(() => {
    if (book) document.title = `${book.title} — Royalty Ownership`;
  }, [book]);

  const [previewUnits, setPreviewUnits] = useState<number>(20000);
  const twentyDefault = useMemo(() => {
    if (!book) return null;
    return computePreview(book.market, { usd: 20 });
  }, [book]);
  useEffect(() => { if (twentyDefault) setPreviewUnits(twentyDefault.units); }, [twentyDefault]);

  if (isLoading) return <div className="container py-10">Loading…</div>;
  if (!book) return <div className="container py-10">Book not found.</div>;

  const m = book.market;
  const ownershipPct = (previewUnits / m.total_units) * 100;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <Link to="/royalty" className="text-sm text-muted-foreground underline">← All royalty books</Link>

      <div className="grid lg:grid-cols-2 gap-8 mt-4">
        {/* LEFT — book info */}
        <div className="space-y-4">
          <div className="aspect-[4/3] bg-muted rounded-lg overflow-hidden">
            {book.cover_url ? (
              <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div>
            <h1 className="text-3xl font-bold leading-tight">{book.title}</h1>
            {book.category && <Badge variant="secondary" className="mt-2">{book.category}</Badge>}
          </div>
          <Card className="p-4 space-y-2 text-sm">
            <Row label="Current selling price" value={usd(book.price)} strong />
            <Row label="Royalty pool" value={`${(m.royalty_pool_percent * 100).toFixed(0)}% of net revenue`} />
            <Row label="Trailing-30d verified sales" value="New book — no verified sales history yet." muted />
          </Card>
          <Card className="p-4 space-y-2 text-sm">
            <Row label="Indicative book value" value={usd(m.current_indicative_book_value_usd, 0)} strong />
            <Row label="Initial book value" value={usd(m.initial_book_value_usd, 0)} muted />
            <Row label="Unit price" value={usd(m.current_indicative_unit_price_usd, 4)} />
            <Row label="Total units" value={num(m.total_units)} />
            <Row label="Units available" value={num(m.units_available)} />
            <Row label="Minimum purchase" value={usd(m.minimum_purchase_usd)} />
          </Card>
        </div>

        {/* RIGHT — calculator */}
        <div className="space-y-4">
          <Card className="p-5 space-y-4">
            <h2 className="text-lg font-semibold">Purchase Calculator</h2>
            <PurchaseCalculatorWithReadout
              bookId={book.book_id}
              market={m}
              onUnitsChange={setPreviewUnits}
            />
          </Card>

          <OneSaleEconomics market={m} units={previewUnits} />
          <BreakEvenBox market={m} units={previewUnits} />

          <Card className="p-4 text-sm text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">Lifetime Revenue Share</div>
            <p>
              Owning {num(previewUnits)} Royalty Units gives you {pct(ownershipPct, 4)} of every distributable royalty pool from this book, for the lifetime of the book on SecretPDF. There is no expiry.
            </p>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <RoyaltyDisclaimers />
      </div>
    </div>
  );
}

function PurchaseCalculatorWithReadout({
  bookId, market, onUnitsChange,
}: { bookId: string; market: import("@/lib/royalty/math").MarketRow; onUnitsChange: (u: number) => void }) {
  // The calculator manages its own state; we re-read the DOM value via a
  // custom event dispatch is overkill. Instead, subscribe to its Reserve
  // via the units input directly by re-computing here on mount.
  useEffect(() => {
    const handler = () => {
      const el = document.getElementById("units") as HTMLInputElement | null;
      if (el) onUnitsChange(Math.max(0, Math.floor(Number(el.value) || 0)));
    };
    const t = window.setInterval(handler, 300);
    return () => window.clearInterval(t);
  }, [onUnitsChange]);
  return <PurchaseCalculator bookId={bookId} market={market} />;
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-foreground" : muted ? "text-muted-foreground" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
