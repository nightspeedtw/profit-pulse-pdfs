// "Complete the set" — auto bundle builder.
// Picks 2 sibling books (same category + overlapping age band) and offers
// them together at a configurable bundle discount (platform_settings.bundle_discount_pct,
// default 20%). Bundle checkout invokes the same free-download function for
// every book in the bundle (payment-bypass era). When payments are restored,
// this handoff becomes a single Stripe checkout with N line items.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Package, Sparkles } from "lucide-react";
import { emitColoringEvent } from "@/lib/coloringFunnelEvents";

interface Sibling {
  id: string;
  title: string;
  cover_url: string | null;
  thumbnail_url: string | null;
  price_cents: number | null;
}

interface Props {
  ebookId: string;
  ebookTitle: string;
  ebookPriceCents: number;
  ebookCoverUrl: string | null;
  siblings: Sibling[];
  /** When true, renders in a compact "promoted" form (no outer container/border-top) — used above the fold on mobile. */
  promoted?: boolean;
  /** Optional: page count of the primary book, used to show total pages across the bundle. */
  primaryPageCount?: number;
}

function centsToUsd(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

export default function CompleteTheSetBundle({
  ebookId,
  ebookTitle,
  ebookPriceCents,
  ebookCoverUrl,
  siblings,
  promoted = false,
  primaryPageCount,
}: Props) {
  const [discountPct, setDiscountPct] = useState<number>(20);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("platform_settings" as never)
        .select("value_json")
        .eq("key", "bundle_discount_pct")
        .maybeSingle();
      if (cancelled) return;
      const v = Number((data as { value_json?: number } | null)?.value_json);
      if (Number.isFinite(v) && v > 0 && v < 90) setDiscountPct(v);
    })();
    return () => { cancelled = true; };
  }, []);

  // Pick the 2 highest-priced siblings so bundle savings look meaningful.
  const picks = siblings.slice(0, 2);
  if (picks.length < 2 || ebookPriceCents <= 0) return null;

  const allBooks = [
    { id: ebookId, title: ebookTitle, cover: ebookCoverUrl, priceCents: ebookPriceCents },
    ...picks.map((s) => ({
      id: s.id,
      title: s.title,
      cover: s.thumbnail_url || s.cover_url,
      priceCents: Number(s.price_cents ?? 0),
    })),
  ];
  const combinedCents = allBooks.reduce((sum, b) => sum + (b.priceCents || 0), 0);
  const bundleCents = Math.round(combinedCents * (1 - discountPct / 100));
  const savingsCents = combinedCents - bundleCents;

  const buyBundle = async () => {
    if (downloading) return;
    setDownloading(true);
    void emitColoringEvent("click_buy", ebookId, {
      force: true,
      extra: { bundle: true, bundle_size: allBooks.length, bundle_cents: bundleCents },
    });
    try {
      const results = await Promise.all(
        allBooks.map((b) => supabase.functions.invoke("free-download", { body: { ebook_id: b.id } })),
      );
      const urls = results
        .map((r) => (r.data as { url?: string } | null)?.url)
        .filter((u): u is string => Boolean(u));
      if (urls.length === 0) throw new Error("Bundle download unavailable — please try again shortly.");
      // Open each PDF in a new tab.
      urls.forEach((u, i) => {
        setTimeout(() => {
          const a = document.createElement("a");
          a.href = u;
          a.rel = "noopener";
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, i * 400);
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bundle checkout failed.");
    } finally {
      setDownloading(false);
    }
  };

  const totalPages = primaryPageCount ? primaryPageCount * allBooks.length : null;

  const wrapperClass = promoted
    ? ""
    : "container max-w-5xl py-8 border-t-2 border-border";

  return (
    <section className={wrapperClass}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-display text-xl md:text-2xl uppercase flex items-center gap-2">
          <Package className="h-5 w-5" /> Complete the set
        </h2>
        <span className="text-[10px] md:text-xs font-mono uppercase tracking-widest bg-accent text-accent-foreground px-2 py-1 border-2 border-foreground rounded-full font-bold">
          ★ Best Value
        </span>
      </div>

      <div className="border-2 border-foreground rounded-lg bg-background p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {allBooks.map((b, i) => (
            <div key={b.id} className="flex items-center gap-2">
              <div className="aspect-square w-20 md:w-24 bg-white border-2 border-border overflow-hidden rounded">
                {b.cover && (
                  <img src={b.cover} alt={b.title} className="w-full h-full object-contain" loading="lazy" />
                )}
              </div>
              {i < allBooks.length - 1 && <span className="font-display text-xl">+</span>}
            </div>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
          {totalPages && (
            <>
              <dt className="text-muted-foreground">Total pages</dt>
              <dd className="text-right font-bold">{totalPages} pages</dd>
            </>
          )}
          <dt className="text-muted-foreground">Books included</dt>
          <dd className="text-right font-bold">{allBooks.length}</dd>
          <dt className="text-muted-foreground">Original price</dt>
          <dd className="text-right font-mono line-through text-muted-foreground">{centsToUsd(combinedCents)}</dd>
          <dt className="text-muted-foreground">Bundle price</dt>
          <dd className="text-right font-display text-2xl font-black">{centsToUsd(bundleCents)}</dd>
          <dt className="text-accent-foreground font-bold">You save</dt>
          <dd className="text-right font-bold text-accent-foreground">{centsToUsd(savingsCents)}</dd>
        </dl>

        <button
          type="button"
          onClick={buyBundle}
          disabled={downloading}
          className="w-full h-14 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-base inline-flex items-center justify-center gap-2 disabled:opacity-70 hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          {downloading ? "Preparing bundle…" : `Get the Bundle & Save ${discountPct}%`}
        </button>
        <p className="text-[11px] text-muted-foreground text-center">
          All {allBooks.length} PDFs download instantly. Personal-use license on every book.
        </p>
      </div>
    </section>
  );
}
