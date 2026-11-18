import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { useResolvedKidsPrices } from "@/lib/useResolvedPricing";
import { formatUsd, kidsCheckoutPath, rememberReturnPath } from "@/lib/kidsCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

interface Book {
  id: string;
  title: string;
  cover_url: string | null;
  thumbnail_url: string | null;
  price_cents: number;
  book_type: string | null;
  storefront_meta: Record<string, unknown> | null;
}

/**
 * Single-book checkout for kids picture books and coloring books.
 * Payment runs through the Paddle overlay (transaction created server-side
 * by `resolve-checkout-price`); the purchase is fulfilled by the
 * `payments-webhook` function and appears in the buyer's library.
 */
export default function KidsCheckout() {
  const { id } = useParams<{ id: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const resolved = useResolvedKidsPrices(book?.id ? [book.id] : []);

  useEffect(() => {
    document.title = "Checkout | SecretPDF";
    let cancelled = false;
    (async () => {
      if (!id) { setLoading(false); return; }
      const { data } = await supabase.from("ebooks_kids")
        .select("id,title,cover_url,thumbnail_url,price_cents,book_type,storefront_meta")
        .eq("id", id).maybeSingle();
      if (!cancelled) {
        setBook((data ?? null) as Book | null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return <div className="py-24 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>;
  }
  if (!book) {
    return (
      <div className="container py-24 text-center">
        <p className="font-display text-2xl mb-3">We couldn't find this book</p>
        <Link to="/kids" className="text-accent underline">Back to all books</Link>
      </div>
    );
  }

  // Same source of truth the server charges from (product_pricing, then the
  // book's own price) so the price shown is the price charged.
  const priceCents = resolved[book.id]?.effectiveCents ?? book.price_cents;
  const priceLabel = formatUsd(priceCents);
  const isColoring = book.book_type === "coloring_book";
  const formatLabel = isColoring ? "Printable coloring book · PDF" : "Picture book · PDF";
  const imgFit = isColoring ? "object-contain" : "object-cover";
  const thumbSrc = isColoring ? (book.thumbnail_url || book.cover_url) : (book.cover_url || book.thumbnail_url);
  const hasImage = !!thumbSrc && thumbSrc !== "/placeholder.svg";

  return (
    <>
      <PaymentTestModeBanner />
      <div className="container py-8 md:py-14 max-w-4xl">
        <Link to="/kids" className="inline-flex items-center gap-1 min-h-11 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Keep browsing
        </Link>

        <h1 className="font-display text-3xl md:text-4xl mb-2">Checkout</h1>
        <p className="text-sm text-muted-foreground mb-8">Review your order, then pay securely. Your PDF is ready to download right after payment.</p>

        <div className="grid md:grid-cols-[1fr,360px] gap-6 md:gap-10">
          <section className="rounded-2xl border border-border bg-card overflow-hidden" aria-label="Order summary">
            <div className="flex flex-col sm:flex-row">
              <div className={`sm:w-52 aspect-square ${isColoring ? "bg-white" : "bg-muted"} flex-shrink-0 flex items-center justify-center`}>
                {hasImage
                  ? <img src={thumbSrc!} alt={book.title} className={`w-full h-full ${imgFit}`} />
                  : <span className="font-display text-3xl text-muted-foreground">PDF</span>}
              </div>
              <div className="p-5 flex-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{formatLabel}</p>
                <h2 className="font-display text-xl md:text-2xl leading-tight mb-2">{book.title}</h2>
                <ul className="text-sm text-muted-foreground space-y-1.5 mt-3">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> Instant PDF download after payment</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> Print at home as often as you like</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> Saved to your library for later</li>
                </ul>
              </div>
            </div>
            <div className="border-t border-border p-5 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total (USD)</span>
              <span className="font-display text-2xl tabular-nums">{priceLabel}</span>
            </div>
            <p className="px-5 pb-5 text-xs text-muted-foreground">Any applicable sales tax or VAT is calculated in the next step.</p>
          </section>

          <aside className="rounded-2xl border border-border bg-card p-5 h-fit">
            <PaymentSection bookId={book.id} priceLabel={priceLabel} />
          </aside>
        </div>
      </div>
    </>
  );
}

function PaymentSection({ bookId, priceLabel }: { bookId: string; priceLabel: string }) {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { openBookCheckout, loading } = usePaddleCheckout();

  const signIn = () => {
    rememberReturnPath(kidsCheckoutPath(bookId));
    nav("/account/sign-in");
  };

  const pay = async () => {
    if (!user) return signIn();
    try {
      await openBookCheckout({
        bookId,
        userId: user.id,
        customerEmail: user.email ?? undefined,
        successUrl: `${window.location.origin}/account/library?purchase=success`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`We couldn't start the checkout. Please try again. (${msg})`);
    }
  };

  if (authLoading) {
    return <div className="py-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>;
  }

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Payment</p>
      <button
        type="button"
        onClick={pay}
        disabled={loading}
        className="w-full min-h-12 py-3.5 rounded-xl bg-accent text-accent-foreground font-display text-sm inline-flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60 mb-3"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {loading ? "Opening secure checkout…" : user ? `Pay ${priceLabel}` : "Sign in to buy"}
      </button>
      <p className="text-xs text-muted-foreground text-center">
        {user
          ? "Secure payment by Paddle. Cards and other local payment methods are shown at checkout."
          : "Sign in or create a free account so your purchase is saved to your library."}
      </p>
      <p className="text-xs text-muted-foreground text-center mt-3">
        <Link to="/refund-policy" className="underline">Refund policy</Link> · <Link to="/terms" className="underline">Terms</Link>
      </p>
    </>
  );
}
