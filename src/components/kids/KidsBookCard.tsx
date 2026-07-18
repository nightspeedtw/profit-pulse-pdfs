import { Link } from "react-router-dom";
import { Eye, FileText } from "lucide-react";
import type { KidsTheme } from "@/lib/kidsTaxonomy";

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
  const cc = (book.storefront_meta as { conversion_copy?: { short_hook?: string; selling_hook?: string } } | null)
    ?.conversion_copy ?? null;
  const tagline = cc?.short_hook || cc?.selling_hook || "";
  const priceLabel = `$${(book.price_cents / 100).toFixed(2)}`;

  const primaryThemeId = book.theme_ids?.[0];
  const themeObj = primaryThemeId ? themes.find((t) => t.id === primaryThemeId) : null;
  const chipLabel = (themeObj?.label_en || themeObj?.slug || "kids").toUpperCase();

  const isStrip = variant === "strip";
  const isColoring = book.book_type === "coloring_book";
  const productHref = isColoring ? `/kids/coloring/${book.id}` : `/product/${book.id}`;
  const buyHref = isColoring ? `/kids/coloring/${book.id}` : `/kids/checkout/${book.id}`;
  const buyLabel = isColoring ? `SHOP · ${priceLabel}` : `BUY · ${priceLabel}`;

  const image = (isColoring && book.thumbnail_url) ? book.thumbnail_url : book.cover_url;

  // Aspect ratios locked to the actual cover asset shipped by the pipeline.
  // Coloring: 1600×2071 (gpt-image-1 output, letterbox-trimmed thumbnail).
  // Illustrated: 1024×1280. object-contain protects legacy covers.
  const aspectClass = isColoring ? "aspect-[1600/2071]" : "aspect-[1024/1280]";

  return (
    <Link
      to={productHref}
      aria-label={`ดูรายละเอียด ${book.title}`}
      className={[
        "group brutal-card flex flex-col overflow-hidden animate-fade-in-up",
        isStrip ? "flex-shrink-0 w-64 md:w-72" : "",
      ].join(" ")}
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
    >
      <div className={`relative bg-white overflow-hidden border-b-2 border-foreground ${aspectClass}`}>
        {image ? (
          <img
            src={image}
            alt={book.title}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-contain object-center group-hover:scale-[1.04] transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileText className="h-16 w-16" strokeWidth={1.5} />
          </div>
        )}

        {/* Theme chip — sticker style, matches storefront */}
        <span className="absolute top-3 left-3 sticker z-20">{chipLabel}</span>

        {/* Price badge — boxed like ProductCard */}
        <span className="absolute top-3 right-3 z-20 font-display text-lg px-3 py-1 border-2 border-foreground bg-white text-foreground">
          {priceLabel}
        </span>

        {!isStrip && onPreview && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPreview(); }}
            className="absolute inset-x-3 bottom-3 z-20 py-2 border-2 border-foreground bg-background/95 backdrop-blur text-xs font-mono uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center gap-1.5"
          >
            <Eye className="h-3.5 w-3.5" /> ดูตัวอย่างข้างใน
          </button>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1 gap-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-accent-foreground font-bold line-clamp-1">
          {chipLabel}
        </p>
        <h3 className="font-display text-lg uppercase leading-tight line-clamp-2">{book.title}</h3>
        {tagline && (
          <p className="text-sm text-muted-foreground line-clamp-2 italic flex-1">{tagline}</p>
        )}
        <div className="text-xs text-muted-foreground leading-relaxed">
          <div>{isColoring ? "Printable coloring pages" : "32 illustrated pages"}</div>
          <div>{isColoring ? "Ages-tuned line thickness" : "Original character"}</div>
        </div>
        <span
          className="mt-auto w-full h-11 bg-foreground text-background font-display uppercase text-sm tracking-wider border-2 border-foreground group-hover:bg-accent group-hover:text-accent-foreground transition-colors flex items-center justify-center gap-2"
          onClick={(e) => { e.stopPropagation(); window.location.href = buyHref; }}
          role="button"
        >
          {buyLabel}
        </span>
      </div>
    </Link>
  );
};
