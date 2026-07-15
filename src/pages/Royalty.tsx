import { useQuery } from "@tanstack/react-query";
import { listRoyaltyBooks } from "@/lib/royalty/api";
import { RoyaltyBookCard } from "@/components/royalty/RoyaltyBookCard";
import { RoyaltyDisclaimers } from "@/components/royalty/RoyaltyDisclaimers";
import { Card } from "@/components/ui/card";
import { usd, num } from "@/lib/royalty/math";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export default function Royalty() {
  useEffect(() => {
    document.title = "Royalty Ownership — Own Royalty Units From SecretPDF Books";
    const meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const desc = "Purchase Royalty Units from selected SecretPDF books and receive a proportional lifetime share of distributable royalty revenue from every eligible sale.";
    if (meta) meta.content = desc;
    else {
      const m = document.createElement("meta");
      m.name = "description"; m.content = desc; document.head.appendChild(m);
    }
  }, []);

  const { data: books = [], isLoading } = useQuery({
    queryKey: ["royalty-books"],
    queryFn: listRoyaltyBooks,
  });

  const totalUnitsPurchased = books.reduce((s, b) => s + (b.market.total_units - b.market.units_available), 0);
  const indicativeMarketValue = books.reduce((s, b) => s + b.market.current_indicative_book_value_usd, 0);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <section className="text-center py-10 space-y-4 max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Own Royalty Units From SecretPDF Books
        </h1>
        <p className="text-lg text-muted-foreground">
          Purchase Royalty Units from selected SecretPDF books and receive a proportional lifetime share of their distributable royalty revenue whenever those books generate eligible sales.
        </p>
        <p className="text-sm text-muted-foreground">
          Each book contains 1,000,000 Royalty Units. Unit value starts from the book's initial valuation and may change according to verified sales performance.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Button asChild size="lg"><a href="#books">Explore Books</a></Button>
          <Button asChild size="lg" variant="outline"><a href="#how">How Royalty Units Work</a></Button>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <Stat label="Books Available" value={num(books.length)} />
        <Stat label="Royalty Units Purchased" value={num(totalUnitsPurchased)} note="Simulated" />
        <Stat label="Total Verified Book Sales" value={num(0)} note="Simulated" />
        <Stat label="Royalties Recorded" value={usd(0)} note="Simulated" />
        <Stat label="Indicative Market Value" value={usd(indicativeMarketValue, 0)} note="Estimate" />
      </section>

      <section id="books" className="mb-10">
        <h2 className="text-2xl font-semibold mb-4">Books available for Royalty Ownership</h2>
        {isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : books.length === 0 ? (
          <div className="text-muted-foreground">No books listed yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {books.map((b) => <RoyaltyBookCard key={b.book_id} book={b} />)}
          </div>
        )}
      </section>

      <section id="how" className="mb-10 grid md:grid-cols-3 gap-4">
        <HowCard n={1} title="Pick a book" body="Browse SecretPDF books available for Royalty Ownership. Each has 1,000,000 Royalty Units." />
        <HowCard n={2} title="Choose your amount" body="Enter USD or Royalty Units. Minimum subtotal is $20 before tax and fees. See ownership, break-even, and one-sale royalty live." />
        <HowCard n={3} title="Earn on every sale" body="Whenever the book sells, the distributable royalty pool is split pro-rata to holders based on units owned." />
      </section>

      <div className="mb-6 flex justify-center">
        <Link to="/my-royalties" className="text-sm underline text-muted-foreground">View my royalties →</Link>
      </div>

      <RoyaltyDisclaimers />
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

function HowCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <Card className="p-5 space-y-2">
      <div className="text-xs text-muted-foreground">Step {n}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </Card>
  );
}
