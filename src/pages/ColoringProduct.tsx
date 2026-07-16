// Dedicated sell page for coloring books. Reads only sanitized/customer-safe
// fields from ebooks_kids — never renders internal QC/brief JSON, never
// exposes the sold PDF URL pre-purchase (that's what pipeline_skills
// coloring_sales_page_conversion_v1 codifies as house law).
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import DOMPurify from "isomorphic-dompurify";
import { Loader2, Download, Eye, Printer, ShieldCheck, Sparkles, Home } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { emitColoringEvent } from "@/lib/coloringFunnelEvents";
import { ColoringPreviewLightbox } from "@/components/kids/ColoringPreviewLightbox";

interface Row {
  id: string;
  title: string;
  subtitle: string | null;
  book_type: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  price_cents: number | null;
  storefront_meta: Record<string, any> | null;
  customer_product_description_html: string | null;
  listing_status: string | null;
  metadata: Record<string, any> | null;
}

interface Sibling { id: string; title: string; cover_url: string | null; price_cents: number | null; }

function centsToUsd(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function ageBandLabel(min: number, max: number): string {
  if (min <= 3 && max <= 5) return "Toddler & Preschool";
  if (min <= 5) return "Preschool";
  if (min <= 6) return "Early Kids";
  if (min <= 8) return "Kids";
  if (max <= 12) return "Tweens";
  if (max <= 17) return "Teens";
  if (min >= 60) return "Seniors";
  if (min >= 18) return "Adults";
  return "All Ages";
}

export default function ColoringProduct() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.from("ebooks_kids")
        .select("id,title,subtitle,book_type,cover_url,thumbnail_url,price_cents,storefront_meta,customer_product_description_html,listing_status,metadata")
        .eq("id", id)
        .eq("listing_status", "live")
        .maybeSingle();
      if (cancelled) return;
      if (error || !data || data.book_type !== "coloring_book") {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setBook(data as Row);
      setLoading(false);
      void emitColoringEvent("view_product", data.id);

      // Cross-sell rail: same category, same age band, other live coloring books.
      const meta = (data.storefront_meta ?? {}) as any;
      const catKey = meta.category_key ?? null;
      const ageMin = Number(meta.age_min ?? 4);
      const ageMax = Number(meta.age_max ?? 6);
      if (catKey) {
        const { data: sibs } = await supabase.from("ebooks_kids")
          .select("id,title,cover_url,price_cents,storefront_meta")
          .eq("book_type", "coloring_book")
          .eq("listing_status", "live")
          .neq("id", data.id)
          .limit(24);
        const filtered = (sibs ?? []).filter((s: any) => {
          const sm = (s.storefront_meta ?? {}) as any;
          if (sm.category_key !== catKey) return false;
          const smin = Number(sm.age_min ?? 0), smax = Number(sm.age_max ?? 99);
          return !(smax < ageMin || smin > ageMax);
        }).slice(0, 6);
        if (!cancelled) setSiblings(filtered as Sibling[]);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return <div className="py-24 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>;
  }
  if (notFound || !book) {
    return (
      <div className="container py-24 text-center">
        <p className="font-display text-2xl mb-3">Coloring book not found</p>
        <Link to="/kids" className="text-accent underline">Browse coloring books</Link>
      </div>
    );
  }

  const meta = (book.storefront_meta ?? {}) as any;
  const pricing = meta.pricing ?? null;
  const priceCents = Number(book.price_cents ?? pricing?.price_cents ?? 0);
  const priceText = centsToUsd(priceCents);
  const categoryName = String(meta.category_name ?? "Coloring Book");
  const ageMin = Number(meta.age_min ?? 4);
  const ageMax = Number(meta.age_max ?? 6);
  const pageCount = Number(meta.page_count ?? pricing?.page_count ?? 32);
  const bandLabel = ageBandLabel(ageMin, ageMax);
  const previewUrls: string[] = Array.isArray(meta.preview_page_urls) ? meta.preview_page_urls.slice(0, 6) : [];
  const contactSheetThumbs: string[] = Array.isArray(meta.contact_sheet_thumbs)
    ? meta.contact_sheet_thumbs.slice(0, 10)
    : previewUrls.slice(0, 6);

  const seoTitle = `${book.title} — Printable Coloring Book Ages ${ageMin}-${ageMax} (${pageCount} pages)`;
  const seoDesc = `Instant PDF download. ${pageCount} unique ${categoryName.toLowerCase()} coloring pages for ages ${ageMin}–${ageMax}. Print at home on 8.5×11 paper, personal-use license, no ads, no repeats.`.slice(0, 160);
  const canonical = typeof window !== "undefined" ? `${window.location.origin}/kids/coloring/${book.id}` : `/kids/coloring/${book.id}`;
  const ogImage = book.thumbnail_url || book.cover_url || undefined;

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: book.title,
    description: seoDesc,
    image: ogImage ? [ogImage] : undefined,
    category: `${categoryName} coloring book, ages ${ageMin}-${ageMax}`,
    brand: { "@type": "Brand", name: "SecretPDF" },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: (priceCents / 100).toFixed(2),
      availability: "https://schema.org/InStock",
      url: canonical,
    },
  };

  const openPreview = () => {
    if (previewUrls.length === 0 && !book.cover_url) return;
    void emitColoringEvent("open_preview", book.id);
    setPreview(true);
  };

  const [downloading, setDownloading] = useState(false);
  const clickBuy = async () => {
    if (!book || downloading) return;
    void emitColoringEvent("click_buy", book.id, { force: true, extra: { price_cents: priceCents, bypass: true } });
    setDownloading(true);
    try {
      // PAYMENT BYPASS (temporary owner directive): coloring books deliver the
      // PDF instantly via the existing free-download function. When payments
      // are re-enabled, restore `navigate(`/kids/checkout/${book.id}`)`.
      const { data, error } = await supabase.functions.invoke("free-download", {
        body: { ebook_id: book.id },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("Download link unavailable — book PDF is not ready yet.");
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("[coloring-product] download failed", e);
      alert(e instanceof Error ? e.message : "Download failed. Please try again in a moment.");
    } finally {
      setDownloading(false);
    }
  };


  // Sanitized long copy (server already runs sales_copy_sanitizer; DOMPurify is
  // client-side belt-and-braces so nothing exotic leaks).
  const descHtml = book.customer_product_description_html
    ? DOMPurify.sanitize(book.customer_product_description_html)
    : "";

  return (
    <div className="pb-32 md:pb-16">
      <Helmet>
        <title>{seoTitle}</title>
        <meta name="description" content={seoDesc} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={seoDesc} />
        <meta property="og:type" content="product" />
        <meta property="og:url" content={canonical} />
        {ogImage && <meta property="og:image" content={ogImage} />}
        {priceCents > 0 && <meta property="product:price:amount" content={(priceCents / 100).toFixed(2)} />}
        {priceCents > 0 && <meta property="product:price:currency" content="USD" />}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seoTitle} />
        <meta name="twitter:description" content={seoDesc} />
        {ogImage && <meta name="twitter:image" content={ogImage} />}
        <script type="application/ld+json">{JSON.stringify(productJsonLd)}</script>
      </Helmet>

      <div className="container max-w-5xl pt-6">
        <Link to="/kids" className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">
          <Home className="h-3.5 w-3.5" /> Kids · Coloring
        </Link>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="container max-w-5xl grid md:grid-cols-2 gap-6 md:gap-10 pt-4 pb-8">
        <button
          type="button"
          onClick={openPreview}
          aria-label={`Preview inside ${book.title}`}
          className="relative aspect-square bg-muted border-2 border-foreground overflow-hidden group"
        >
          {book.cover_url ? (
            // object-contain guarantees the WHOLE cover (title + art) fits
            // inside the thumbnail frame — no crop, no cut title.
            <img src={book.cover_url} alt={book.title} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">No cover</div>
          )}
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/95 border-2 border-foreground text-xs font-mono uppercase tracking-widest">
            <Eye className="h-3.5 w-3.5" /> Look inside
          </span>
        </button>

        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <span className="inline-block px-3 py-1 border-2 border-foreground bg-accent text-accent-foreground text-xs font-mono uppercase tracking-widest">
              {bandLabel} · Ages {ageMin}–{ageMax}
            </span>
            <span className="inline-block px-3 py-1 border-2 border-foreground bg-highlight text-xs font-mono uppercase tracking-widest">
              {pageCount} pages
            </span>
            <span className="inline-block px-3 py-1 border-2 border-foreground text-xs font-mono uppercase tracking-widest">
              {categoryName}
            </span>
          </div>

          <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight break-words">
            {book.title}
          </h1>
          {book.subtitle && (
            <p className="text-base md:text-lg text-muted-foreground">{book.subtitle}</p>
          )}

          <div className="inline-block border-2 border-foreground bg-background px-4 py-2">
            <p className="font-display text-3xl md:text-4xl font-black text-foreground tracking-tight">
              {priceText}
            </p>
          </div>

          <button
            type="button"
            onClick={clickBuy}
            disabled={downloading}
            className="w-full h-14 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-base hover:bg-accent hover:text-accent-foreground transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait"
          >
            {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            {downloading ? "Preparing your PDF…" : "Download instantly — print at home"}
          </button>


          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:text-sm text-muted-foreground">
            <li className="inline-flex items-center gap-2"><Download className="h-3.5 w-3.5" /> Instant PDF</li>
            <li className="inline-flex items-center gap-2"><Printer className="h-3.5 w-3.5" /> 8.5×11 print-ready</li>
            <li className="inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Personal-use license</li>
            <li className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Secure checkout</li>
          </ul>
        </div>
      </section>

      {/* ── Parent benefits ──────────────────────────────────────────── */}
      <section className="container max-w-5xl py-8 border-t-2 border-border">
        <h2 className="font-display text-2xl uppercase mb-4">Why parents love it</h2>
        <ul className="grid md:grid-cols-3 gap-4 text-sm md:text-base">
          <li className="p-4 border-2 border-border rounded-lg">
            <strong className="block font-display uppercase mb-1">Screen-free time</strong>
            Quiet, focused coloring that keeps hands busy without a device.
          </li>
          <li className="p-4 border-2 border-border rounded-lg">
            <strong className="block font-display uppercase mb-1">Print unlimited copies</strong>
            One PDF, your whole family — reprint any page whenever a sibling asks.
          </li>
          <li className="p-4 border-2 border-border rounded-lg">
            <strong className="block font-display uppercase mb-1">Age-tuned line thickness</strong>
            Tested outlines for ages {ageMin}–{ageMax} — thick enough for crayons, clean enough for markers.
          </li>
        </ul>
      </section>

      {/* ── What's Inside (previews) ─────────────────────────────────── */}
      <section className="container max-w-5xl py-8 border-t-2 border-border">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-2xl uppercase">What's inside</h2>
          {previewUrls.length > 0 && (
            <button
              type="button"
              onClick={openPreview}
              className="text-xs font-mono uppercase tracking-widest underline hover:text-accent"
            >
              Open flipbook →
            </button>
          )}
        </div>

        {previewUrls.length === 0 ? (
          <div className="p-6 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground text-center">
            Sample previews are being prepared. The cover above shows the art style — every interior page uses the same clean, kid-friendly line work.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {previewUrls.slice(0, 4).map((u, i) => (
              <button
                key={u}
                type="button"
                onClick={openPreview}
                className="relative aspect-square border-2 border-border overflow-hidden group bg-white"
              >
                <img src={u} alt={`${book.title} sample page ${i + 1}`} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-background/90 border border-foreground text-[10px] font-mono uppercase tracking-widest">
                  Preview
                </span>
              </button>
            ))}
          </div>
        )}

        {contactSheetThumbs.length > 0 && (
          <div className="mt-6">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
              {pageCount} unique pages, no repeats
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {contactSheetThumbs.map((u, i) => (
                <img
                  key={`${u}-${i}`}
                  src={u}
                  alt=""
                  loading="lazy"
                  className="h-16 w-14 object-cover border-2 border-border bg-white flex-shrink-0"
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Long description ─────────────────────────────────────────── */}
      {descHtml && (
        <section className="container max-w-3xl py-8 border-t-2 border-border">
          <div
            className="prose prose-sm md:prose-base max-w-none"
            dangerouslySetInnerHTML={{ __html: descHtml }}
          />
        </section>
      )}

      {/* ── Cross-sell rail ─────────────────────────────────────────── */}
      {siblings.length > 0 && (
        <section className="container max-w-5xl py-8 border-t-2 border-border">
          <h2 className="font-display text-2xl uppercase mb-4">More for Ages {ageMin}–{ageMax}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {siblings.map((s) => (
              <Link key={s.id} to={`/kids/coloring/${s.id}`} className="group block">
                <div className="aspect-square bg-muted border-2 border-border overflow-hidden">
                  {s.cover_url && (
                    <img src={s.cover_url} alt={s.title} loading="lazy" className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-500" />
                  )}
                </div>
                <div className="mt-2 text-xs font-display uppercase line-clamp-2 group-hover:text-accent">{s.title}</div>
                <div className="text-xs font-mono text-muted-foreground">{centsToUsd(s.price_cents ?? 0)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Sticky buy on mobile */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t-2 border-foreground px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-lg leading-none">{priceText}</div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{pageCount} pages · Ages {ageMin}–{ageMax}</div>
        </div>
        <button
          type="button"
          onClick={clickBuy}
          className="flex-1 h-12 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-sm inline-flex items-center justify-center gap-2"
        >
          <Download className="h-4 w-4" /> Download
        </button>
      </div>

      <ColoringPreviewLightbox
        ebookId={book.id}
        title={book.title}
        coverUrl={book.cover_url}
        previewUrls={previewUrls}
        open={preview}
        onClose={() => setPreview(false)}
      />
    </div>
  );
}
