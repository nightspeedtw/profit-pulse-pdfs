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
import ProductRating from "@/components/product/ProductRating";
import { deriveSalePricing } from "@/lib/storefrontPricing";
import { useSaleConfig, formatSaleEnds } from "@/lib/saleConfig";
import HighlightsBlock from "@/components/product/HighlightsBlock";
import AddToCollectionButton from "@/components/product/AddToCollectionButton";
import ItemDetailsSection from "@/components/product/ItemDetailsSection";
import SocialProofBadges from "@/components/product/SocialProofBadges";
import CompleteTheSetBundle from "@/components/product/CompleteTheSetBundle";
import FlipbookPreview from "@/components/product/FlipbookPreview";
import ReviewSummary from "@/components/product/ReviewSummary";
import { ensureColoringLabel } from "@/lib/coloring-title";

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

interface Sibling { id: string; title: string; cover_url: string | null; thumbnail_url: string | null; price_cents: number | null; }

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
  const [downloading, setDownloading] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const saleCfg = useSaleConfig();

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
          .select("id,title,cover_url,thumbnail_url,price_cents,storefront_meta")
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

  const displayTitle = ensureColoringLabel(book.title);
  const seoTitle = `${displayTitle} — Printable Coloring Book Ages ${ageMin}-${ageMax} (${pageCount} pages)`;
  const seoDesc = `Instant PDF download. ${pageCount} unique ${categoryName.toLowerCase()} coloring pages for ages ${ageMin}–${ageMax}. Print at home on 8.5×8.5 in square paper, personal-use license, no ads, no repeats.`.slice(0, 160);
  const canonical = typeof window !== "undefined" ? `${window.location.origin}/kids/coloring/${book.id}` : `/kids/coloring/${book.id}`;
  const ogImage = book.thumbnail_url || book.cover_url || undefined;

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: displayTitle,
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
        {(() => {
          // Gallery order (marketing v4): [square_cover, collage, ...interior pages].
          // Falls back to legacy thumbnail/cover + preview URLs on older books.
          // SQUARE-FIRST law (2026-07-18): every coloring surface renders in a
          // square aspect-ratio container with object-contain on white — the
          // marketing thumbnail is native 1:1; legacy rectangular covers must
          // display complete (no crop). Max 6 gallery slots total.
          const galleryFromMeta: string[] = Array.isArray(meta.gallery_urls) ? meta.gallery_urls.filter(Boolean) : [];
          const legacyPrimary = book.thumbnail_url || book.cover_url;
          const galleryRaw: string[] = galleryFromMeta.length
            ? galleryFromMeta
            : [legacyPrimary, ...previewUrls].filter(Boolean) as string[];
          const gallery = galleryRaw.slice(0, 6);
          const safeIdx = Math.min(activeImageIdx, Math.max(0, gallery.length - 1));
          const main = gallery[safeIdx] ?? legacyPrimary;
          const isCoverSlot = safeIdx === 0;
          return (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={openPreview}
                aria-label={`Preview inside ${displayTitle}`}
                className="relative aspect-square bg-white border-2 border-foreground overflow-hidden group rounded-md"
              >
                {main ? (
                  <img
                    src={main}
                    alt={isCoverSlot ? displayTitle : `${displayTitle} — sample ${safeIdx}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">No cover</div>
                )}
              </button>
              <button
                type="button"
                onClick={openPreview}
                className="self-center inline-flex items-center gap-2 px-4 py-2 rounded-full bg-background border-2 border-foreground text-xs font-mono uppercase tracking-widest hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Eye className="h-3.5 w-3.5" /> Look inside
              </button>
              {gallery.length > 1 && (
                <div className={`grid gap-2 ${gallery.length >= 5 ? "grid-cols-6" : "grid-cols-5"}`}>
                  {gallery.map((u, i) => (
                    <button
                      key={`${u}-${i}`}
                      type="button"
                      onClick={() => setActiveImageIdx(i)}
                      aria-label={`View image ${i + 1}`}
                      className={`aspect-square overflow-hidden rounded border-2 bg-white transition-all ${
                        i === safeIdx ? "border-foreground ring-2 ring-accent" : "border-border hover:border-foreground"
                      }`}
                    >
                      <img src={u} alt="" loading="lazy" className="w-full h-full object-contain" />
                    </button>
                  ))}
                  {gallery.length >= 2 && (
                    <FlipbookPreview images={gallery} title={displayTitle} />
                  )}
                </div>
              )}
            </div>
          );
        })()}

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
            {displayTitle}
          </h1>
          {book.subtitle && (
            <p className="text-base md:text-lg text-muted-foreground">{book.subtitle}</p>
          )}

          <ProductRating ebookId={book.id} />

          {(() => {
            const sp = deriveSalePricing(book.id, priceCents, book.storefront_meta);
            const salesEndsLabel = saleCfg?.enabled ? formatSaleEnds(saleCfg.ends_at) : null;
            return (
              <div className="space-y-1">
                <div className="inline-flex items-baseline flex-wrap gap-x-3 gap-y-1 border-2 border-foreground bg-background px-4 py-2">
                  <span className="font-display text-3xl md:text-4xl font-black text-foreground tracking-tight">
                    {sp.priceLabel}
                  </span>
                  {sp.originalLabel && (
                    <span className="font-mono text-sm text-muted-foreground line-through">
                      {sp.originalLabel}
                    </span>
                  )}
                  {sp.discountPct != null && (
                    <span className="font-mono text-xs text-accent-foreground font-bold">
                      ({sp.discountPct}% off{salesEndsLabel ? ` · Sale ends ${salesEndsLabel}` : ""})
                    </span>
                  )}
                </div>
                <p className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  <Download className="h-3.5 w-3.5" /> Digital Download · Instant PDF
                </p>
              </div>
            );
          })()}

          <SocialProofBadges ebookId={book.id} />

          <button
            type="button"
            onClick={clickBuy}
            disabled={downloading}
            className="w-full h-14 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-base hover:bg-accent hover:text-accent-foreground transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait"
          >
            {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            {downloading ? "Preparing your PDF…" : "Download instantly — print at home"}
          </button>

          <AddToCollectionButton ebookId={book.id} />

          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:text-sm text-muted-foreground">
            <li className="inline-flex items-center gap-2"><Download className="h-3.5 w-3.5" /> Instant PDF</li>
            <li className="inline-flex items-center gap-2"><Printer className="h-3.5 w-3.5" /> 8.5×8.5 in square, print-ready</li>
            <li className="inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Personal-use license</li>
            <li className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Secure checkout</li>
          </ul>

          <HighlightsBlock
            pageCount={pageCount}
            ageMin={ageMin}
            ageMax={ageMax}
            categoryName={categoryName}
          />
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
                <img src={u} alt={`${displayTitle} sample page ${i + 1}`} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
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

      {/* ── Item details (Etsy-style, auto-generated) ────────────────── */}
      <section className="container max-w-5xl py-8 border-t-2 border-border">
        <h2 className="font-display text-2xl uppercase mb-4">Item details</h2>
        <ItemDetailsSection
          pageCount={pageCount}
          ageMin={ageMin}
          ageMax={ageMax}
          categoryName={categoryName}
          themes={Array.isArray(meta.themes) ? meta.themes.slice(0, 12) : []}
        />
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

      {/* ── Complete-the-set bundle (auto, discounted) ──────────────── */}
      <CompleteTheSetBundle
        ebookId={book.id}
        ebookTitle={displayTitle}
        ebookPriceCents={priceCents}
        ebookCoverUrl={book.cover_url}
        siblings={siblings}
      />

      {/* ── Review summary (auto, real reviews only) ─────────────────── */}
      <ReviewSummary ebookId={book.id} />


      {/* ── Cross-sell rail ─────────────────────────────────────────── */}
      {siblings.length > 0 && (
        <section className="container max-w-5xl py-8 border-t-2 border-border">
          <h2 className="font-display text-2xl uppercase mb-4">More for Ages {ageMin}–{ageMax}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {siblings.map((s) => (
              <Link key={s.id} to={`/kids/coloring/${s.id}`} className="group block">
                <div className="aspect-square bg-white border-2 border-border overflow-hidden">
                  {(s.thumbnail_url || s.cover_url) && (
                    <img src={s.thumbnail_url || s.cover_url!} alt={s.title} loading="lazy" className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-500" />
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
          disabled={downloading}
          className="flex-1 h-12 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-sm inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading ? "Preparing…" : "Download"}
        </button>

      </div>

      <ColoringPreviewLightbox
        ebookId={book.id}
        title={displayTitle}
        coverUrl={book.cover_url}
        previewUrls={previewUrls}
        open={preview}
        onClose={() => setPreview(false)}
      />
    </div>
  );
}
