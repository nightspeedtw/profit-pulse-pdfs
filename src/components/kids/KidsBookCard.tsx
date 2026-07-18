import { Link } from "react-router-dom";
import { Eye, FileText } from "lucide-react";
import type { KidsTheme } from "@/lib/kidsTaxonomy";

export interface KidsBookCardData {
  id: string;
  title: string;
  cover_url: string | null;
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

  return (
    <div
      className={[
        "group flex flex-col rounded-2xl border-2 border-border bg-card overflow-hidden",
        "transition-all hover:-translate-y-1 hover:shadow-brand hover:border-accent/50 animate-fade-in-up",
        isStrip ? "flex-shrink-0 w-56 md:w-64" : "",
      ].join(" ")}
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
    >
      <Link
        to={productHref}
        aria-label={`ดูรายละเอียด ${book.title}`}
        // Container aspect tracks the actual art aspect. Coloring covers'
        // display asset (thumbnail_url) is now trimmed to source content
        // (gpt-image-1 = 2:3), so the frame hugs the raster with no white
        // letterbox bars on the storefront. Fallback object-contain still
        // protects legacy covers.
        className={[
          "relative bg-muted overflow-hidden block cursor-pointer",
          isColoring ? "aspect-[2/3]" : "aspect-[1024/1280]",
        ].join(" ")}
      >
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            loading="lazy"
            // object-contain is the safety net: even if a legacy cover of a
            // different ratio sneaks in, we letterbox instead of clipping the
            // baked title. Aspect-matched containers above make this a no-op
            // for correctly-sized covers.
            className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
          </div>
        )}

        {/* Theme chip */}
        <span className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-accent/90 text-accent-foreground font-mono uppercase tracking-widest text-[10px] shadow-soft">
          {chipLabel}
        </span>

        {/* Price badge — boxed */}
        <span className="absolute top-2 right-2 border-2 border-foreground bg-background px-2 py-0.5 rounded-md font-display text-sm shadow-soft">
          {priceLabel}
        </span>

        {!isStrip && onPreview && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPreview(); }}
            className="absolute inset-x-2 bottom-2 py-1.5 rounded-lg bg-background/95 backdrop-blur text-xs font-mono uppercase tracking-wide opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center gap-1"
          >
            <Eye className="h-3.5 w-3.5" /> ดูตัวอย่างข้างใน
          </button>
        )}
      </Link>

      <div className="p-4 flex flex-col gap-2 flex-1 border-t-2 border-border">
        <Link to={productHref} className="hover:text-accent transition-colors">
          <h3 className="font-display uppercase text-base md:text-lg leading-tight tracking-tight line-clamp-2">
            {book.title}
          </h3>
        </Link>
        {tagline && (
          <p className="text-sm text-muted-foreground line-clamp-2 italic">{tagline}</p>
        )}
        <div className="text-xs text-muted-foreground leading-relaxed mt-1">
          <div>{isColoring ? "Printable coloring pages" : "32 illustrated pages"}</div>
          <div>{isColoring ? "Ages-tuned line thickness" : "Original character"}</div>
        </div>
        <div className="mt-auto pt-3">
          <Link
            to={buyHref}
            className="block w-full text-center py-2.5 rounded-md bg-foreground text-background font-display tracking-wide text-sm hover:bg-accent transition-colors"
          >
            {buyLabel}
          </Link>
        </div>
      </div>
    </div>
  );
};
