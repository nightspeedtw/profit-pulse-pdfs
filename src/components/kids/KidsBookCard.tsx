import { Link } from "react-router-dom";
import { Download, Eye, FileText, Star } from "lucide-react";
import type { KidsTheme } from "@/lib/kidsTaxonomy";
import { deriveSalePricing, derivePlatformReview, PLATFORM_REVIEW_TOOLTIP } from "@/lib/storefrontPricing";

export interface KidsBookCardData {
  id: string;
  title: string;
  cover_url: string | null;
  thumbnail_url?: string | null;
  price_cents: number;
  theme_ids: string[];
  storefront_meta: Record<string, unknown> | null;
  book_type?: string | null;
}

interface Props {
  book: KidsBookCardData;
  themes: KidsTheme[];
  variant?: "grid" | "strip";
  index?: number;
  onPreview?: () => void;
}

export const KidsBookCard = ({ book, themes, variant = "grid", index = 0, onPreview }: Props) => {
  const primaryThemeId = book.theme_ids?.[0];
  const themeObj = primaryThemeId ? themes.find((t) => t.id === primaryThemeId) : null;
  const chipLabel = (themeObj?.label_en || themeObj?.slug || "kids").toUpperCase();

  const isStrip = variant === "strip";
  const isColoring = book.book_type === "coloring_book";
  const productHref = isColoring ? `/kids/coloring/${book.id}` : `/product/${book.id}`;
  const buyHref = isColoring ? `/kids/coloring/${book.id}` : `/kids/checkout/${book.id}`;

  const image = (isColoring && book.thumbnail_url) ? book.thumbnail_url : book.cover_url;

  // Etsy-style card = square art on top, meta rows below.
  const aspectClass = "aspect-square";

  const pricing = deriveSalePricing(book.id, book.price_cents, book.storefront_meta);
  const rating = derivePlatformReview(book.id);

  return (
    <div
      className={[
        "group brutal-card flex flex-col overflow-hidden animate-fade-in-up",
        isStrip ? "flex-shrink-0 w-64 md:w-72" : "",
      ].join(" ")}
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
    >
      <Link
        to={productHref}
        aria-label={`ดูรายละเอียด ${book.title}`}
        className={`relative bg-white overflow-hidden border-b-2 border-foreground block ${aspectClass}`}
      >
        {image ? (
          <img
            src={image}
            alt={book.title}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-[1.04] transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileText className="h-16 w-16" strokeWidth={1.5} />
          </div>
        )}

        <span className="absolute top-3 left-3 sticker z-20">{chipLabel}</span>
        {pricing.discountPct != null && (
          <span className="absolute top-3 right-3 z-20 font-mono text-[11px] font-bold px-2 py-1 border-2 border-foreground bg-accent text-accent-foreground uppercase tracking-widest">
            −{pricing.discountPct}%
          </span>
        )}

        {!isStrip && onPreview && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPreview(); }}
            className="absolute inset-x-3 bottom-3 z-20 py-2 border-2 border-foreground bg-background/95 backdrop-blur text-xs font-mono uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center gap-1.5"
          >
            <Eye className="h-3.5 w-3.5" /> ดูตัวอย่างข้างใน
          </button>
        )}
      </Link>

      <div className="p-4 flex flex-col flex-1 gap-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-accent-foreground font-bold line-clamp-1">
          {chipLabel}
        </p>
        <Link to={productHref} className="hover:text-accent transition-colors">
          <h3 className="font-display text-base uppercase leading-tight line-clamp-2">{book.title}</h3>
        </Link>

        {/* Rating row — platform review, honestly labeled */}
        <div
          className="inline-flex items-center gap-1.5 text-xs"
          title={PLATFORM_REVIEW_TOOLTIP}
          aria-label={`Platform rating ${rating.average.toFixed(1)} out of 5, ${rating.count} team reviews`}
        >
          <span className="flex" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className="h-3.5 w-3.5 fill-foreground text-foreground" strokeWidth={1.5} />
            ))}
          </span>
          <span className="font-mono text-muted-foreground">({rating.count})</span>
        </div>

        {/* Price row: sale + strikethrough + % off */}
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
          <span className="font-display text-xl font-black text-foreground tracking-tight">
            {pricing.priceLabel}
          </span>
          {pricing.originalLabel && (
            <>
              <span className="font-mono text-xs text-muted-foreground line-through">
                {pricing.originalLabel}
              </span>
              {pricing.discountPct != null && (
                <span className="font-mono text-[11px] text-accent-foreground font-bold">
                  ({pricing.discountPct}% off)
                </span>
              )}
            </>
          )}
        </div>

        {/* Digital Download label — Etsy convention */}
        <p className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          <Download className="h-3 w-3" strokeWidth={2} /> Digital Download
        </p>

        <Link
          to={buyHref}
          className="mt-auto w-full h-11 bg-foreground text-background font-display uppercase text-sm tracking-wider border-2 border-foreground hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-center gap-2"
        >
          {isColoring ? "Shop now" : "Buy now"}
        </Link>
      </div>
    </div>
  );
};
